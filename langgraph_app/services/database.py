import os
import uuid
import json
from datetime import datetime, timezone
import psycopg2
import asyncpg
from dotenv import load_dotenv

load_dotenv(override=True)


def get_db_connection():
    """
    Creates and returns a PostgreSQL connection using environment variables.
    """
    host = os.getenv("DB_HOST", "").strip()
    user = os.getenv("DB_USER", "").strip()
    port = os.getenv("DB_PORT", "5432").strip()
    dbname = os.getenv("DB_NAME", "claims_iq").strip()
    password = os.getenv("DB_PASSWORD", "").strip()
    sslmode = os.getenv("DB_SSLMODE", "require").strip()
    
    print(f"[Database] Connecting to {host} as {user}...")
    return psycopg2.connect(
        host=host,
        port=port,
        dbname=dbname,
        user=user,
        password=password,
        sslmode=sslmode,
    )


def save_claim_to_db(
    user_id: str,
    form_category: str,
    blob_uri: str,
    status: str,
    extracted_data: dict,
    evaluation_results: dict,
) -> str:
    """
    Inserts a claim record into the claims_history table.
    Returns the generated claim UUID.
    """
    claim_id = str(uuid.uuid4())
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO claims_history 
                (id, user_id, form_category, blob_uri, status, extracted_data, evaluation_results, created_at)
            VALUES 
                (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                claim_id,
                user_id,
                form_category,
                blob_uri,
                status,
                json.dumps(extracted_data),
                json.dumps(evaluation_results),
                datetime.now(timezone.utc),
            ),
        )
        conn.commit()
        cursor.close()
        print(f"[Database] Claim saved: {claim_id}")
        return claim_id
    except Exception as e:
        print(f"[Database] Error saving claim: {e}")
        if conn:
            conn.rollback()
        raise
    finally:
        if conn:
            conn.close()

def sync_user_to_db(auth_provider_id: str, email: str = "") -> dict:
    """
    Syncs a Clerk user into the 'users' table atomically to prevent race conditions.
    Returns a dict containing the user's internal 'id' and 'role'.
    """
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        new_user_id = str(uuid.uuid4())
        
        # Use COALESCE to prevent overwriting existing email with dummy email
        query = """
            INSERT INTO users (id, auth_provider_id, email, role)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (auth_provider_id) 
            DO UPDATE SET email = COALESCE(EXCLUDED.email, users.email)
            RETURNING id, role
        """
        actual_email = email if email else f"no-email-{auth_provider_id}@placeholder.com"
        cursor.execute(query, (new_user_id, auth_provider_id, actual_email, None))
        row = cursor.fetchone()
        
        if row:
            user_id = row[0]
            role = row[1]
        else:
            # Fallback if returning fails for some edge case
            user_id = new_user_id
            role = None
            
        conn.commit()
        cursor.close()
        
        # Resolve legacy orphans (syncing old Clerk-ID-based claims to this internal UUID)
        backfill_orphaned_claims(user_id)
        
        return {"id": user_id, "role": role}
    except Exception as e:
        print(f"[Database] Error syncing user: {e}")
        if conn:
            conn.rollback()
        raise
    finally:
        if conn:
            conn.close()

def get_user_by_clerk_id(clerk_id: str, email: str = "") -> dict:
    """
    Looks up a user's internal UUID and role by their Clerk ID. 
    If they don't exist, it atomically creates them in a single query.
    Returns a dictionary: {"id": <internal uuid>, "role": <role>}
    """
    try:
        return sync_user_to_db(clerk_id, email)
    except Exception as e:
        print(f"[Database] Error fetching user by clerk ID: {e}")
        # Return fallback missing values to not break frontend explicitly immediately
        return {"id": None, "role": None}

def check_duplicate_claim(policy_number: str, claimant_id: str, incident_date: str, provider: str) -> bool:
    """
    Checks if a claim with the given combination of policy number, claimant ID, 
    incident date, and provider already exists in the claims_history table.
    Queries the extracted_data column (stored as JSON string).
    If any of the fields are missing, it will only check against the fields that are present.
    """
    fields_to_check = []
    params = []
    
    if policy_number:
        fields_to_check.append("(extracted_data::jsonb)->>'policyNumber' = %s")
        params.append(policy_number)
    if claimant_id:
        fields_to_check.append("(extracted_data::jsonb)->>'claimantId' = %s")
        params.append(claimant_id)
    if incident_date:
        fields_to_check.append("(extracted_data::jsonb)->>'incidentDate' = %s")
        params.append(incident_date)
    if provider:
        fields_to_check.append("(extracted_data::jsonb)->>'providerName' = %s")
        params.append(provider)
        
    if not fields_to_check:
        print("[Database] Duplicate check skipped: no fields provided to check")
        return False
        
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        where_clause = " AND ".join(fields_to_check)
        query = f"SELECT COUNT(*) FROM claims_history WHERE {where_clause}"
        
        print(f"[Database] Checking duplicate matching fields: {params}")
        cursor.execute(query, tuple(params))
        
        count = cursor.fetchone()[0]
        cursor.close()
        
        is_duplicate = count > 0
        print(f"[Database] Duplicate check result: {'DUPLICATE FOUND' if is_duplicate else 'Unique'} (found {count} matches)")
        
        return is_duplicate
    except Exception as e:
        print(f"[Database] Error checking duplicate claim: {e}")
        return False
    finally:
        if conn:
            conn.close()


async def async_check_duplicate_claim(policy_number: str, claimant_id: str, incident_date: str, provider: str) -> bool:
    """
    Async version of check_duplicate_claim using asyncpg.
    Does not block the event loop — safe for parallel LangGraph nodes.
    """
    fields_to_check = []
    params = []
    idx = 1  # asyncpg uses $1, $2, ... placeholders

    if policy_number:
        fields_to_check.append(f"(extracted_data::jsonb)->>'policyNumber' = ${idx}")
        params.append(policy_number)
        idx += 1
    if claimant_id:
        fields_to_check.append(f"(extracted_data::jsonb)->>'claimantId' = ${idx}")
        params.append(claimant_id)
        idx += 1
    if incident_date:
        fields_to_check.append(f"(extracted_data::jsonb)->>'incidentDate' = ${idx}")
        params.append(incident_date)
        idx += 1
    if provider:
        fields_to_check.append(f"(extracted_data::jsonb)->>'providerName' = ${idx}")
        params.append(provider)
        idx += 1

    if not fields_to_check:
        print("[Database-Async] Duplicate check skipped: no fields provided")
        return False

    conn = None
    try:
        host = os.getenv("DB_HOST", "").strip()
        user = os.getenv("DB_USER", "").strip()
        port = int(os.getenv("DB_PORT", "5432").strip())
        dbname = os.getenv("DB_NAME", "claims_iq").strip()
        password = os.getenv("DB_PASSWORD", "").strip()
        sslmode = os.getenv("DB_SSLMODE", "require").strip()

        ssl_val = True if sslmode == "require" else sslmode
        conn = await asyncpg.connect(
            host=host, port=port, user=user, password=password, database=dbname, ssl=ssl_val
        )

        where_clause = " AND ".join(fields_to_check)
        query = f"SELECT COUNT(*) FROM claims_history WHERE {where_clause}"

        print(f"[Database-Async] Checking duplicate matching fields: {params}")
        count = await conn.fetchval(query, *params)

        is_duplicate = count > 0
        print(f"[Database-Async] Duplicate check result: {'DUPLICATE FOUND' if is_duplicate else 'Unique'} (found {count} matches)")
        return is_duplicate
    except Exception as e:
        print(f"[Database-Async] Error checking duplicate claim: {e}")
        return False
    finally:
        if conn:
            await conn.close()

def get_claims_history(user_id: str, is_admin: bool = False) -> list:
    """
    Fetches the claims history.
    If is_admin is True, returns up to 50 claims across ALL users, including their email.
    Otherwise, returns the last 20 claims for the specific user_id.
    """
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        if is_admin:
            print("[Database] Fetching claims history as ADMIN (showing all users)")
            # Join with users table to get the submitter's email
            query = """
                SELECT c.id, c.extracted_data, c.evaluation_results, c.created_at, c.blob_uri, c.form_category, c.status, u.email
                FROM claims_history c
                LEFT JOIN users u ON c.user_id = u.id
                ORDER BY c.created_at DESC 
                LIMIT 50
            """
            cursor.execute(query)
        else:
            # Query for last 20 claims, matching the internal UUID
            query = """
                SELECT id, extracted_data, evaluation_results, created_at, blob_uri, form_category, status, %s as email
                FROM claims_history 
                WHERE user_id = %s
                ORDER BY created_at DESC 
                LIMIT 20
            """
            cursor.execute(query, ('', user_id,))
        
        
        rows = cursor.fetchall()
        cursor.close()
        
        history = []
        for row in rows:
            extracted = row[1] if isinstance(row[1], dict) else json.loads(row[1]) if row[1] else {}
            evaluation = row[2] if isinstance(row[2], dict) else json.loads(row[2]) if row[2] else {}
            
            history.append({
                "id": str(row[0]),
                "claim": extracted.get("claimNumber", "N/A"),
                "claimant": extracted.get("claimantName", "Unknown"),
                "amount": extracted.get("claimAmount"),
                "routing": evaluation.get("routing", row[6]),
                "time": row[3].isoformat() if row[3] else "N/A",
                "confidence": evaluation.get("confidence", 0),
                "extracted": extracted,
                "evaluation": evaluation,
                "blob_uri": row[4],
                "fileName": row[4].split("/")[-1] if row[4] else "document.pdf",
                "submitterEmail": row[7] if row[7] else ""
            })
            
        print(f"[Database] Fetched {len(history)} claims for user: {user_id}")
        return history
    except Exception as e:
        print(f"[Database] Error fetching claims history: {e}")
        return []
    finally:
        if conn:
            conn.close()


def backfill_orphaned_claims(user_id: str) -> int:
    """
    Assigns the given user_id to all claims_history rows where user_id IS NULL.
    Returns the number of updated rows.
    """
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE claims_history SET user_id = %s WHERE user_id IS NULL",
            (user_id,)
        )
        count = cursor.rowcount
        conn.commit()
        cursor.close()
        print(f"[Database] Backfilled {count} orphaned claims with user_id: {user_id}")
        return count
    except Exception as e:
        print(f"[Database] Error backfilling orphaned claims: {e}")
        if conn:
            conn.rollback()
        return 0
    finally:
        if conn:
            conn.close()


# ─── Business Rules CRUD ──────────────────────────────────────────────────────

DEFAULT_RULES = [
    {"id": "BR001", "name": "Claim Amount Threshold", "description": "Claims ≤ $5,000 auto-approved", "rule_type": "threshold", "weight": 30, "priority": 1, "is_active": True, "config": {"field_name": "claimAmount", "operator": "lte", "value": 5000}},
    {"id": "BR002", "name": "High-Value Escalation", "description": "Claims > $25,000 require senior review", "rule_type": "threshold", "weight": 40, "priority": 2, "is_active": True, "config": {"field_name": "claimAmount", "operator": "lte", "value": 25000}},
    {"id": "BR003", "name": "Document Completeness", "description": "All required fields must be present (Min 80%)", "rule_type": "threshold", "weight": 25, "priority": 3, "is_active": True, "config": {"field_name": "completeness", "operator": "gte", "value": 80}},
    {"id": "BR004", "name": "Fraud Indicators", "description": "No fraud flags detected (Threshold ≤ 30)", "rule_type": "threshold", "weight": 50, "priority": 4, "is_active": True, "config": {"field_name": "fraudScore", "operator": "lte", "value": 30}},
    {"id": "BR005", "name": "Policy Active Status", "description": "Policy must be active at time of claim", "rule_type": "comparison", "weight": 35, "priority": 5, "is_active": True, "config": {"field_name": "policyStatus", "operator": "eq", "value": "active"}},
    {"id": "BR006", "name": "Duplicate Claim Check", "description": "No duplicate claim reference found", "rule_type": "cross_field", "weight": 45, "priority": 6, "is_active": True, "config": {"field_name": "claimNumber", "operator": "not_duplicate"}},
]


def ensure_rules_table():
    """Creates the business_rules table if it does not exist."""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS business_rules (
                id VARCHAR(20) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                rule_type VARCHAR(50) NOT NULL,
                weight INTEGER DEFAULT 30,
                priority INTEGER DEFAULT 1,
                is_active BOOLEAN DEFAULT TRUE,
                config JSONB NOT NULL DEFAULT '{}',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        conn.commit()
        cursor.close()
        print("[Database] business_rules table ensured.")
    except Exception as e:
        print(f"[Database] Error ensuring rules table: {e}")
        if conn:
            conn.rollback()
    finally:
        if conn:
            conn.close()


def seed_default_rules():
    """Seeds the business_rules table with defaults if it is empty."""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM business_rules")
        count = cursor.fetchone()[0]
        if count == 0:
            for rule in DEFAULT_RULES:
                cursor.execute(
                    """
                    INSERT INTO business_rules (id, name, description, rule_type, weight, priority, is_active, config)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO NOTHING
                    """,
                    (rule["id"], rule["name"], rule["description"], rule["rule_type"],
                     rule["weight"], rule["priority"], rule["is_active"], json.dumps(rule["config"]))
                )
            conn.commit()
            print(f"[Database] Seeded {len(DEFAULT_RULES)} default business rules.")
        cursor.close()
    except Exception as e:
        print(f"[Database] Error seeding rules: {e}")
        if conn:
            conn.rollback()
    finally:
        if conn:
            conn.close()


def get_all_rules() -> list:
    """Returns all business rules from the database, ordered by priority."""
    ensure_rules_table()
    seed_default_rules()
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, name, description, rule_type, weight, priority, is_active, config
            FROM business_rules
            ORDER BY priority ASC
        """)
        rows = cursor.fetchall()
        cursor.close()
        rules = []
        for row in rows:
            config = row[7] if isinstance(row[7], dict) else json.loads(row[7]) if row[7] else {}
            rules.append({
                "id": row[0],
                "name": row[1],
                "description": row[2],
                "rule_type": row[3],
                "weight": row[4],
                "priority": row[5],
                "is_active": row[6],
                "config": config,
            })
        print(f"[Database] Fetched {len(rules)} business rules.")
        return rules
    except Exception as e:
        print(f"[Database] Error fetching rules: {e}")
        return []
    finally:
        if conn:
            conn.close()


def upsert_rule(rule: dict) -> dict:
    """
    Insert or update a business rule.
    If rule['id'] exists, updates the row. Otherwise inserts a new one.
    Returns the upserted rule.
    """
    ensure_rules_table()
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        rule_id = rule.get("id")
        if not rule_id:
            # Generate a new rule ID using MAX to avoid collisions after deletions
            cursor.execute("""
                SELECT COALESCE(MAX(CAST(SUBSTRING(id FROM 3) AS INTEGER)), 0)
                FROM business_rules
                WHERE id ~ '^BR[0-9]+$'
            """)
            max_num = cursor.fetchone()[0]
            rule_id = f"BR{max_num + 1:03d}"

        config = rule.get("config", {})
        cursor.execute(
            """
            INSERT INTO business_rules (id, name, description, rule_type, weight, priority, is_active, config, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (id)
            DO UPDATE SET
                name = EXCLUDED.name,
                description = EXCLUDED.description,
                rule_type = EXCLUDED.rule_type,
                weight = EXCLUDED.weight,
                priority = EXCLUDED.priority,
                is_active = EXCLUDED.is_active,
                config = EXCLUDED.config,
                updated_at = NOW()
            RETURNING id, name, description, rule_type, weight, priority, is_active, config
            """,
            (
                rule_id,
                rule.get("name", "Unnamed Rule"),
                rule.get("description", ""),
                rule.get("rule_type", "threshold"),
                rule.get("weight", 30),
                rule.get("priority", 99),
                rule.get("is_active", True),
                json.dumps(config),
            )
        )
        row = cursor.fetchone()
        conn.commit()
        cursor.close()

        result = {
            "id": row[0], "name": row[1], "description": row[2],
            "rule_type": row[3], "weight": row[4], "priority": row[5],
            "is_active": row[6],
            "config": row[7] if isinstance(row[7], dict) else json.loads(row[7]) if row[7] else {},
        }
        print(f"[Database] Upserted rule: {result['id']}")
        return result
    except Exception as e:
        print(f"[Database] Error upserting rule: {e}")
        if conn:
            conn.rollback()
        raise
    finally:
        if conn:
            conn.close()


def delete_rule(rule_id: str) -> bool:
    """Deletes a business rule by ID. Returns True if a row was deleted."""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM business_rules WHERE id = %s", (rule_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        cursor.close()
        print(f"[Database] Deleted rule {rule_id}: {deleted}")
        return deleted
    except Exception as e:
        print(f"[Database] Error deleting rule: {e}")
        if conn:
            conn.rollback()
        return False
    finally:
        if conn:
            conn.close()


# ─── Active Sessions ──────────────────────────────────────────────────────────

def ensure_sessions_table():
    """Creates the active_sessions table if it does not exist."""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS active_sessions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL,
                session_token VARCHAR(255) NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                last_active TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        conn.commit()
        cursor.close()
        print("[Database] active_sessions table ensured.")
    except Exception as e:
        print(f"[Database] Error ensuring sessions table: {e}")
        if conn:
            conn.rollback()
    finally:
        if conn:
            conn.close()


def register_session(user_id: str, session_token: str) -> bool:
    """
    Registers a new session for the user, replacing any existing sessions.
    Returns True on success.
    """
    ensure_sessions_table()
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        # Remove old sessions for this user
        cursor.execute("DELETE FROM active_sessions WHERE user_id = %s", (user_id,))
        # Insert new session
        cursor.execute(
            "INSERT INTO active_sessions (user_id, session_token) VALUES (%s, %s)",
            (user_id, session_token)
        )
        conn.commit()
        cursor.close()
        print(f"[Database] Session registered for user: {user_id}")
        return True
    except Exception as e:
        print(f"[Database] Error registering session: {e}")
        if conn:
            conn.rollback()
        return False
    finally:
        if conn:
            conn.close()


def check_active_session(user_id: str, session_token: str) -> dict:
    """
    Checks if another session exists for this user.
    Returns {"conflict": True/False, "existing_token": ...}
    """
    ensure_sessions_table()
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT session_token FROM active_sessions WHERE user_id = %s",
            (user_id,)
        )
        row = cursor.fetchone()
        cursor.close()

        if row is None:
            # No active session — no conflict
            return {"conflict": False}
        
        existing_token = row[0]
        if existing_token == session_token:
            # Same browser/tab — no conflict
            return {"conflict": False}
        
        # Different session token — conflict!
        return {"conflict": True}
    except Exception as e:
        print(f"[Database] Error checking session: {e}")
        return {"conflict": False}  # fail-open to avoid locking users out
    finally:
        if conn:
            conn.close()


def terminate_session(user_id: str) -> bool:
    """Terminates all active sessions for a user."""
    ensure_sessions_table()
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM active_sessions WHERE user_id = %s", (user_id,))
        conn.commit()
        cursor.close()
        print(f"[Database] Terminated sessions for user: {user_id}")
        return True
    except Exception as e:
        print(f"[Database] Error terminating session: {e}")
        if conn:
            conn.rollback()
        return False
    finally:
        if conn:
            conn.close()


# ─── Claim Deletion ───────────────────────────────────────────────────────────

def delete_claim(claim_id: str, user_id: str, is_admin: bool = False) -> bool:
    """
    Deletes a claim from claims_history.
    Admins can delete any claim; regular users can only delete their own.
    Returns True if a row was deleted.
    """
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        if is_admin:
            cursor.execute("DELETE FROM claims_history WHERE id = %s", (claim_id,))
        else:
            cursor.execute(
                "DELETE FROM claims_history WHERE id = %s AND user_id = %s",
                (claim_id, user_id)
            )
        deleted = cursor.rowcount > 0
        conn.commit()
        cursor.close()
        print(f"[Database] Deleted claim {claim_id}: {deleted}")
        return deleted
    except Exception as e:
        print(f"[Database] Error deleting claim: {e}")
        if conn:
            conn.rollback()
        return False
    finally:
        if conn:
            conn.close()
