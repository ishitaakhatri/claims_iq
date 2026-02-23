# Stage 1: Build the React Application
FROM node:18-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Serve the React application with FastAPI
FROM python:3.10-slim

WORKDIR /app

# Install backend dependencies
COPY langgraph_app/requirements.txt ./langgraph_app/
RUN pip install --no-cache-dir -r langgraph_app/requirements.txt

# Copy backend code
COPY langgraph_app/ ./langgraph_app/

# Copy the built React app from the build stage into a 'dist' directory
COPY --from=build /app/dist ./dist

# Expose the port (the port the Azure guide expects!)
EXPOSE 8000

# Command to run the FastAPI app
CMD ["uvicorn", "langgraph_app.main:app", "--host", "0.0.0.0", "--port", "8000"]
