import os
import uuid
import json
from datetime import datetime
import psycopg2
from dotenv import load_dotenv

load_dotenv()


def get_db_connection():
    """
    Creates and returns a PostgreSQL connection using environment variables.
    """
    host = os.getenv("DB_HOST")
    user = os.getenv("DB_USER")
    print(f"🔍 [Database] Connecting to {host} as {user}...")
    return psycopg2.connect(
        host=host,
        port=os.getenv("DB_PORT", "5432"),
        dbname=os.getenv("DB_NAME", "claims_iq"),
        user=user,
        password=os.getenv("DB_PASSWORD"),
        sslmode=os.getenv("DB_SSLMODE", "require"),
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
