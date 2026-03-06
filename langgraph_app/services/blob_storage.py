import os
import base64
import uuid
from azure.storage.blob import BlobServiceClient
from dotenv import load_dotenv

load_dotenv()


def upload_to_blob(file_data_b64: str, file_name: str) -> str:
    """
    Uploads a base64-encoded file to Azure Blob Storage.
    Returns the blob URL.
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

    blob_url = blob_client.url
    print(f"[Blob Storage] Uploaded: {blob_url}")
    return blob_url
