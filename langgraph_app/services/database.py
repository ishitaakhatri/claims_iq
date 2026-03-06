import os
import uuid
import json
from datetime import datetime, timezone
import psycopg2
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
        
        # Use COALESCE(NULLIF) to prevent overwriting existing email with empty strings
        query = """
            INSERT INTO users (id, auth_provider_id, email, role)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (auth_provider_id) 
            DO UPDATE SET email = COALESCE(NULLIF(EXCLUDED.email, ''), users.email)
            RETURNING id, role
        """
        cursor.execute(query, (new_user_id, auth_provider_id, email, None))
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

def check_duplicate_claim(claim_number: str) -> bool:
    """
    Checks if a claim with the given claim_number already exists in the claims_history table.
    Queries the extracted_data column (stored as JSON string).
    """
    if not claim_number:
        print("[Database] Duplicate check skipped: no claim number provided")
        return False
        
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Use explicit cast to jsonb for reliable querying on varchar column
        query = "SELECT COUNT(*) FROM claims_history WHERE (extracted_data::jsonb)->>'claimNumber' = %s"
        print(f"[Database] Checking duplicate for claim number: '{claim_number}'")
        cursor.execute(query, (claim_number,))
        
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
                "time": row[3].strftime("%I:%M:%S %p") if row[3] else "N/A",
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
