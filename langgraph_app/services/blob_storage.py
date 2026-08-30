import os
import base64
import uuid
from urllib.parse import urlparse
from azure.storage.blob import BlobServiceClient
from dotenv import load_dotenv

load_dotenv()


from datetime import datetime, timedelta, timezone
from azure.storage.blob import BlobServiceClient, generate_blob_sas, BlobSasPermissions

def upload_to_blob(file_data_b64: str, file_name: str) -> str:
    """
    Uploads a base64-encoded file to Azure Blob Storage.
    Generates a read-only SAS token valid for 7 days and returns the authenticated URL.
    """
    connection_string = os.getenv("AZURE_STORAGE_CONNECTION_STRING")
    container_name = os.getenv("AZURE_STORAGE_CONTAINER_NAME")

    if not connection_string or not container_name:
        raise ValueError("Azure Blob Storage credentials not configured in .env")

    # Decode the base64 file data
    print(f"[Blob Storage] Decoding base64 data for {file_name}...")
    file_bytes = base64.b64decode(file_data_b64)
    print(f"[Blob Storage] Decoded size: {len(file_bytes)} bytes")

    # Generate a unique blob name to avoid collisions
    unique_prefix = uuid.uuid4().hex[:8]
    blob_name = f"{unique_prefix}_{file_name}"
    print(f"[Blob Storage] Generated blob name: {blob_name}")

    # Upload to Azure Blob Storage
    print(f"[Blob Storage] Initializing BlobServiceClient...")
    blob_service_client = BlobServiceClient.from_connection_string(connection_string)
    blob_client = blob_service_client.get_blob_client(
        container=container_name, blob=blob_name
    )

    print(f"[Blob Storage] Starting upload of {blob_name}...")
    blob_client.upload_blob(file_bytes, overwrite=True)

    # Note: extracting account key from the connecting string
    # A cleaner approach in prod is using Managed Identities, but this works for development
    account_key = dict(item.split("=", 1) for item in connection_string.split(";") if item).get("AccountKey")
    account_name = blob_service_client.account_name

    # Just return the base URL; SAS tokens will be generated dynamically on read
    blob_url = blob_client.url

    print(f"[Blob Storage] Uploaded: {blob_url}")
    return blob_url

def generate_read_sas_url(blob_url: str) -> str:
    """
    Takes a blob URL (with or without an existing SAS token) and returns 
    the URL with a freshly generated 7-day SAS token.
    """
    if not blob_url:
        return blob_url
        
    connection_string = os.getenv("AZURE_STORAGE_CONNECTION_STRING")
    container_name = os.getenv("AZURE_STORAGE_CONTAINER_NAME")

    if not connection_string or not container_name:
        return blob_url
        
    try:
        # Strip any existing query params (e.g. old expired SAS token)
        base_url = blob_url.split("?")[0]
        
        parsed = urlparse(base_url)
        path_parts = parsed.path.lstrip("/").split("/")
        if len(path_parts) >= 2:
            blob_name = "/".join(path_parts[1:])
        else:
            return blob_url
            
        account_key = dict(item.split("=", 1) for item in connection_string.split(";") if item).get("AccountKey")
        blob_service_client = BlobServiceClient.from_connection_string(connection_string)
        account_name = blob_service_client.account_name
        
        if account_key and account_name:
            sas_token = generate_blob_sas(
                account_name=account_name,
                container_name=container_name,
                blob_name=blob_name,
                account_key=account_key,
                permission=BlobSasPermissions(read=True),
                expiry=datetime.now(timezone.utc) + timedelta(days=7)
            )
            return f"{base_url}?{sas_token}"
    except Exception as e:
        print(f"[Blob Storage] Error generating SAS token for URL {blob_url}: {e}")
        
    return blob_url
