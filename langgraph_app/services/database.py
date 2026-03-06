import os
import uuid
import json
from datetime import datetime
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
    
    print(f"🔍 [Database] Connecting to {host} as {user}...")
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
                datetime.utcnow(),
            ),
        )
        conn.commit()
        cursor.close()
        print(f"✅ [Database] Claim saved: {claim_id}")
        return claim_id
    except Exception as e:
        print(f"❌ [Database] Error saving claim: {e}")
        if conn:
            conn.rollback()
        raise
    finally:
        if conn:
            conn.close()

def sync_user_to_db(auth_provider_id: str, email: str) -> str:
    """
    Syncs a Clerk user into the 'users' table.
    Uses auth_provider_id as the lookup key. 
    If not exists, inserts with a new UUID.
    If exists, updates the email (or other fields in the future).
    Returns the user's internal UUID.
    """
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Check if user exists by auth_provider_id
        cursor.execute(
            "SELECT id FROM users WHERE auth_provider_id = %s",
            (auth_provider_id,)
        )
        row = cursor.fetchone()
        
        if row:
            user_id = row[0]
            # Update existing user (e.g. email)
            cursor.execute(
                "UPDATE users SET email = %s WHERE auth_provider_id = %s",
                (email, auth_provider_id)
            )
        else:
            # Create new user with a fresh UUID
            user_id = str(uuid.uuid4())
            cursor.execute(
                """
                INSERT INTO users (id, auth_provider_id, email, role)
                VALUES (%s, %s, %s, %s)
                """,
                (user_id, auth_provider_id, email, None)
            )
            
        conn.commit()
        cursor.close()
        print(f"✅ [Database] User synced: {auth_provider_id} -> {user_id}")
        return user_id
    except Exception as e:
        print(f"❌ [Database] Error syncing user: {e}")
        if conn:
            conn.rollback()
        raise
    finally:
        if conn:
            conn.close()

def check_duplicate_claim(claim_number: str) -> bool:
    """
    Checks if a claim with the given claim_number already exists in the claims_history table.
    Queries the extracted_data column (stored as JSON string).
    """
    if not claim_number:
        print("🔍 [Database] Duplicate check skipped: no claim number provided")
        return False
        
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Use explicit cast to jsonb for reliable querying on varchar column
        query = "SELECT COUNT(*) FROM claims_history WHERE (extracted_data::jsonb)->>'claimNumber' = %s"
        print(f"🔍 [Database] Checking duplicate for claim number: '{claim_number}'")
        cursor.execute(query, (claim_number,))
        
        count = cursor.fetchone()[0]
        cursor.close()
        
        is_duplicate = count > 0
        print(f"🔍 [Database] Duplicate check result: {'DUPLICATE FOUND' if is_duplicate else 'Unique'} (found {count} matches)")
        
        return is_duplicate
    except Exception as e:
        print(f"❌ [Database] Error checking duplicate claim: {e}")
        return False
    finally:
        if conn:
            conn.close()

def get_claims_history(user_id: str) -> list:
    """
    Fetches the last 20 claims for a specific user from the claims_history table.
    Matches on:
      1. claims_history.user_id = internal DB uuid
      2. claims_history.user_id = auth_provider_id (Clerk ID) from users table
    """
    if not user_id:
        return []

    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # First, get the auth_provider_id for this user so we can match old claims
        cursor.execute("SELECT auth_provider_id FROM users WHERE id = %s", (user_id,))
        user_row = cursor.fetchone()
        auth_provider_id = user_row[0] if user_row else None
        
        # Query for last 20 claims, matching either the internal UUID or the Clerk ID
        if auth_provider_id:
            query = """
                SELECT id, extracted_data, evaluation_results, created_at, blob_uri, form_category, status
                FROM claims_history 
                WHERE user_id = %s OR user_id = %s
                ORDER BY created_at DESC 
                LIMIT 20
            """
            cursor.execute(query, (user_id, auth_provider_id))
        else:
            query = """
                SELECT id, extracted_data, evaluation_results, created_at, blob_uri, form_category, status
                FROM claims_history 
                WHERE user_id = %s
                ORDER BY created_at DESC 
                LIMIT 20
            """
            cursor.execute(query, (user_id,))
        
        rows = cursor.fetchall()
        cursor.close()
        
        history = []
        for row in rows:
            extracted = row[1] if isinstance(row[1], dict) else json.loads(row[1]) if row[1] else {}
            evaluation = row[2] if isinstance(row[2], dict) else json.loads(row[2]) if row[2] else {}
            
            history.append({
                "id": row[0],
                "claim": extracted.get("claimNumber", "N/A"),
                "claimant": extracted.get("claimantName", "Unknown"),
                "amount": extracted.get("claimAmount"),
                "routing": evaluation.get("routing", row[6]),
                "time": row[3].strftime("%I:%M:%S %p") if row[3] else "N/A",
                "confidence": evaluation.get("confidence", 0),
                "extracted": extracted,
                "evaluation": evaluation,
                "blob_uri": row[4],
                "fileName": row[4].split("/")[-1] if row[4] else "document.pdf"
            })
            
        print(f"✅ [Database] Fetched {len(history)} claims for user: {user_id}")
        return history
    except Exception as e:
        print(f"❌ [Database] Error fetching claims history: {e}")
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
        print(f"✅ [Database] Backfilled {count} orphaned claims with user_id: {user_id}")
        return count
    except Exception as e:
        print(f"❌ [Database] Error backfilling orphaned claims: {e}")
        if conn:
            conn.rollback()
        return 0
    finally:
        if conn:
            conn.close()
