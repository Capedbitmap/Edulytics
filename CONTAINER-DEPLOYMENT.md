

# Deploying EduLytics from Scratch

This document outlines the complete process for deploying the EduLytics application to a live server from a fresh code checkout. The deployment architecture uses **Docker** for containerization and **Nginx Proxy Manager** on a DigitalOcean Droplet to handle HTTPS and reverse proxying.

## Prerequisites

Before you begin, ensure you have the following accounts, files, and tools ready:

1.  **Accounts & Services:**
    *   A **GitHub** account with access to the `JS-Lecture-Transciption` repository.
    *   A **Docker Hub** account with a public repository created (e.g., `duoclefts/edulytics`).
    *   A **DigitalOcean** account (ideally with student credits).
    *   A registered **Domain Name** (e.g., `edulytics.live`) ready to be configured.

2.  **Local Files:**
    *   Your `firebase-credentials.json` file downloaded from your Firebase project.
    *   Your OpenAI API key and other secrets.

3.  **Local Software (on your Mac):**
    *   [Git](https://git-scm.com/downloads)
    *   [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running.

---

## Phase 1: Local Setup & Configuration

This phase prepares your project on your local machine before it's packaged for the server.

### Step 1: Clone the Repository
Clone a fresh copy of the project from GitHub into a new folder on your Mac.

```bash
git clone https://github.com/your-username/JS-Lecture-Transciption.git
cd JS-Lecture-Transciption
```

### Step 2: Create Secret Files
Your application relies on two crucial files that should **never** be committed to Git.

1.  **Firebase Credentials:**
    *   Place your downloaded `firebase-credentials.json` file inside the project's root directory.

2.  **Environment Variables (`.env` file):**
    *   In the project's root directory, create a new file named `.env`.
    *   Copy and paste the following template into it, filling in your actual secret values.

    ```dotenv
    # .env - Production Environment Variables

    # OpenAI API Key
    OPENAI_API_KEY=sk-YourSecretOpenAiApiKeyHere

    # Firebase Database URL (from your Firebase project settings)
    FIREBASE_DATABASE_URL=https://your-project-id-default-rtdb.firebaseio.com

    # Session Secret (important: generate a long, random string for this)
    SECRET_KEY=use_a_strong_random_string_of_at_least_32_characters_here

    # Email Configuration (for verification emails)
    SMTP_HOST=smtp.gmail.com
    SMTP_PORT=587
    SMTP_SECURE=false
    SMTP_USER=your-email@gmail.com
    SMTP_PASSWORD=your_gmail_or_provider_app_specific_password

    # LaTeX path inside the Docker container (this should not be changed)
    LATEX_PATH=/usr/bin/pdflatex
    ```

---

## Phase 2: Building and Pushing the Docker Image

Now, we package the application into a multi-platform Docker image and upload it to Docker Hub.

### Step 1: One-Time Docker Buildx Setup
If this is the first time you are doing a multi-platform build on your Mac, you need to create a builder instance. **You only need to do this once.**

```bash
docker buildx create --name mybuilder --use
```

### Step 2: Build and Push the Image
This single command builds your image for both your Mac's architecture (`arm64`) and the server's architecture (`amd64`) and pushes it to Docker Hub.

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t duoclefts/edulytics:latest --push .
```
When this command finishes, your application image is ready and stored online.

---

## Phase 3: Server Provisioning (DigitalOcean)

This phase sets up the cloud server where your application will run.

### Step 1: Create the DigitalOcean Droplet
1.  Log in to your DigitalOcean dashboard.
2.  Click **Create -> Droplets**.
3.  **Region**: Choose a server location near your users.
4.  **Image**: Click the **Marketplace** tab and search for `Nginx Proxy Manager`. Select this 1-Click App. This installs Docker and the proxy manager for you.
5.  **Plan**: Select a **Basic (Shared CPU)** plan. The cheapest option (e.g., 1 GB RAM / 1 CPU) is sufficient to start.
6.  **Authentication**: Select **SSH Key** and add your public SSH key for secure access.
7.  **Hostname**: Name your Droplet (e.g., `edulytics-server`).
8.  Click **Create Droplet**.

### Step 2: Configure DNS
1.  Copy the **IPv4 address** of your newly created Droplet.
2.  Go to your domain registrar's DNS settings.
3.  Create two **"A" records**:
    *   **Record 1:** Host: `@`, Value: `YOUR_DROPLET_IP`
    *   **Record 2:** Host: `www`, Value: `YOUR_DROPLET_IP`

### Step 3: Configure the Server Firewall
1.  Connect to your Droplet via SSH from your Mac's terminal:
    ```bash
    ssh root@YOUR_DROPLET_IP
    ```
2.  The firewall (`ufw`) is usually active. We need to allow traffic for Nginx and SSH.
    ```bash
    # Allow SSH connections (should already be configured)
    sudo ufw allow 'OpenSSH'

    # Allow HTTP and HTTPS traffic for Nginx
    sudo ufw allow 'Nginx Full'

    # Enable the firewall if it's not already active
    sudo ufw enable

    # Check the final status
    sudo ufw status
    ```
    The output should show that `OpenSSH` and `Nginx Full` are allowed.

---

## Phase 4: Deploying the Containers on the Server

Now, we run both Nginx Proxy Manager and your application in separate containers connected by a shared network.

### Step 1: Create the Docker Network
This virtual network allows the containers to communicate securely by name.

```bash
# Run this on your Droplet (in the SSH session)
docker network create my-app-network
```

### Step 2: Run the Nginx Proxy Manager Container
The Nginx Proxy Manager Droplet should have already started this container. You can verify with `docker ps`. If it's not running, use this command to start it. **Important:** The paths `/root/npm/data` and `/root/npm/letsencrypt` ensure your settings and SSL certificates are saved permanently on the Droplet, even if the container is restarted.

```bash
# Verify if 'npm' container is running with 'docker ps'. If not, run this:
docker run -d \
  -p 80:80 \
  -p 81:81 \
  -p 443:443 \
  --name npm \
  --network my-app-network \
  -v /root/npm/data:/data \
  -v /root/npm/letsencrypt:/etc/letsencrypt \
  jc21/nginx-proxy-manager:latest
```

### Step 3: Copy Secret Files to the Server
1.  **Copy the `.env` file** to your server. Create it using `nano`:
    ```bash
    # On the Droplet
    nano .env
    ```
    Paste the contents of your local `.env` file, then save (`Ctrl+X`, `Y`, `Enter`).

2.  **Copy the Firebase credentials**. Run this command from your **local Mac terminal** (not the SSH session):
    ```bash
    scp ./firebase-credentials.json root@YOUR_DROPLET_IP:/root/firebase-credentials.json
    ```

### Step 4: Pull and Run Your Application Container
Now, start your `edulytics` application.

```bash
# On the Droplet
# 1. Pull the image from Docker Hub
docker pull duoclefts/edulytics:latest

# 2. Run the container, connecting it to the shared network
docker run \
  -d \
  --restart=always \
  --name lecture-app \
  --network my-app-network \
  --env-file ./.env \
  -v /root/firebase-credentials.json:/app/firebase-credentials.json \
  duoclefts/edulytics:latest
```

---

## Phase 5: Configuring Nginx Proxy Manager

This is the final step, done through your web browser.

1.  **Log in to NPM Admin Panel**: Go to `http://YOUR_DROPLET_IP:81`.
    -   Default Email: `admin@example.com`
    -   Default Password: `changeme`
    -   Follow the prompts to immediately change these credentials.

2.  **Add SSL Certificate**:
    -   Navigate to **SSL Certificates** -> **Add SSL Certificate** -> **Let's Encrypt**.
    -   Under **Domain Names**, enter `edulytics.live` and `www.edulytics.live`.
    -   Agree to the terms and click **Save**.

3.  **Create the Proxy Host**:
    -   Navigate to **Hosts** -> **Proxy Hosts** -> **Add Proxy Host**.
    -   **Details Tab:**
        -   **Domain Names**: Add `edulytics.live` and `www.edulytics.live`.
        -   **Forward Hostname / IP**: `lecture-app` (the name of your app container).
        -   **Forward Port**: `8080` (the port your app exposes *inside* the container).
        -   Enable **Block Common Exploits**.
        -   Enable **Websockets Support** (CRITICAL for Socket.IO).
    -   **SSL Tab:**
        -   **SSL Certificate**: Select the `edulytics.live` certificate from the dropdown.
        -   Enable **Force SSL**.
        -   Enable **HTTP/2 Support**.
    -   Click **Save**.

## Final Verification
Navigate to **https://edulytics.live**. Your application should be live, secure, and fully functional.