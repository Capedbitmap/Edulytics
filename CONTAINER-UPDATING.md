

# Updating Your Live `edulytics.live` Website

This guide provides the exact steps to update your live application after you have made code changes on your local machine (your Mac). This process is designed to be repeatable, fast, and safe, ensuring you don't have to go through the initial setup again.

## Prerequisites

Before you begin, make sure you have done the following:
1.  Made your desired code changes to the application.
2.  Saved all your files.
3.  Opened the **Docker Desktop application** on your Mac and verified it is running (the whale icon in your menu bar is steady and green).

The entire update process is divided into two phases: actions on your local Mac, and actions on your live DigitalOcean server.

---

## Phase 1: Building and Pushing the Update (On Your Mac)

In this phase, you will package your updated code into a new Docker image and upload it to Docker Hub.

### Step 1: Open a Terminal Window

Open your macOS Terminal application. Make sure you are in the correct directory.

```bash
# Navigate to your project's root folder (the one with the Dockerfile)
cd /path/to/your/JS-Lecture-Transciption
```

### Step 2: Build & Push the Multi-Platform Image

This is the single most important command for the update. It builds an image that works on both your Mac (`arm64`) and your Linux server (`amd64`), and then automatically pushes it to your Docker Hub repository.

Run the following command exactly as written:

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t duoclefts/edulytics:latest --push .
```

**What this command does:**
- `docker buildx build`: Uses Docker's advanced builder.
- `--platform linux/amd64,linux/arm64`: Builds the image for both server and Apple Silicon architectures.
- `-t duoclefts/edulytics:latest`: Tags the new image with your correct repository name and the `latest` tag.
- `--push`: Pushes the image to Docker Hub immediately after a successful build.
- `.`: Tells Docker to use the current directory as the source.

You will see a lot of output as Docker rebuilds the necessary parts of your application. When it finishes without errors, your updated code will be stored on Docker Hub, ready for the server to download.

---

## Phase 2: Deploying the Update (On the Server)

In this phase, you will connect to your live server, download the new image, and restart the application.

### Step 3: Connect to Your DigitalOcean Droplet via SSH

Use your terminal to securely connect to your server.

```bash
ssh root@edulytics.live
```
*(You can use your domain name now that it's configured).*

### Step 4: Pull the Latest Image from Docker Hub

Once connected to the server, download the new version of the image you just pushed. Docker on the server will automatically select the `linux/amd64` version that it needs.

```bash
docker pull duoclefts/edulytics:latest
```You should see output indicating that layers are being downloaded and that a "newer image" has been found.

### Step 5: Stop and Remove the Old, Running Container

To replace the running application with the new version, you must first stop and remove the old container. This frees up the name `lecture-app` and ensures a clean start.

```bash
# Stop the currently running container
docker stop lecture-app

# Remove the stopped container
docker rm lecture-app
```
**Note:** It's okay if these commands show an error like `No such container`. This just means the app wasn't running, which is fine.

### Step 6: Start the New Container with the Correct Command

This is the final step. You will run the **exact same `docker run` command** you used during the final, successful setup. This command starts a new container using your updated image and connects it to the Nginx Proxy Manager network.

```bash
docker run \
  -d \
  --restart=always \
  --name lecture-app \
  --network my-app-network \
  --env-file ./.env \
  -v /root/firebase-credentials.json:/app/firebase-credentials.json \
  duoclefts/edulytics:latest
```
**Important:** Do **NOT** add a `-p` port mapping flag (like `-p 8080:8080`). Your Nginx Proxy Manager handles all traffic, and the container communicates with it directly over the `my-app-network`.

### Step 7: Verify the Update is Live

Your update is now deployed. Here’s how to check that everything is working:

1.  **Check Docker on the server:**
    ```bash
    docker ps
    ```
    You should see the `lecture-app` container with a status like "Up a few seconds". This confirms it started correctly.

2.  **Visit Your Website:**
    Open your web browser and go to **`https://edulytics.live`**.
    You may need to do a **hard refresh** to clear your browser's cache and see the changes. On a Mac, the shortcut is **`Cmd + Shift + R`**.

---

## Quick Reference (The Commands)

Once you're comfortable with the process, here is the cheatsheet for future updates.

#### On Your Mac:
```bash
docker buildx build --platform linux/amd64,linux/arm64 -t duoclefts/edulytics:latest --push .
```

#### On the Server (`ssh root@edulytics.live`):
```bash
docker pull duoclefts/edulytics:latest
docker stop lecture-app
docker rm lecture-app
# Paste your full docker run command here
docker run -d --restart=always --name lecture-app --network my-app-network --env-file ./.env -v /root/firebase-credentials.json:/app/firebase-credentials.json duoclefts/edulytics:latest
```

## Common Troubleshooting

-   **I see a 502 Bad Gateway error after updating.**
    -   SSH into your server and check the logs immediately: `docker logs lecture-app`. Your new code might have a bug that prevents the server from starting. The logs will tell you exactly what the error is.
-   **My changes aren't showing up.**
    -   Perform a hard refresh in your browser (`Cmd + Shift + R`).
    -   Double-check that you successfully pushed the new image from your Mac and pulled it on the server.