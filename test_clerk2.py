import os
from clerk_backend_api import Clerk
from dotenv import load_dotenv

load_dotenv(override=True)
clerk_secret = os.getenv("CLERK_SECRET_KEY", "")
clerk = Clerk(bearer_auth=clerk_secret)
try:
    user = clerk.users.get(user_id="user_3AA7CRIoP6XXJ2kshLqQdowpVcv")
    print("User ID:", getattr(user, 'id', 'N/A'))
    email_list = getattr(user, 'email_addresses', [])
    if email_list:
        print("Email:", getattr(email_list[0], 'email_address', ""))
    else:
        print("No emails found.")
except Exception as e:
    print(f"Error: {e}")
