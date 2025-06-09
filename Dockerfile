# Stage 1: Use an official Node.js image as a parent image.
# 'bullseye' is a version of Debian that has a stable package manager (apt-get).
FROM node:18-bullseye

# Stage 2: Install system dependencies, including LaTeX.
# This is the crucial step for your PDF generation feature.
RUN apt-get update && apt-get install -y --no-install-recommends \
    texlive-base \
    texlive-latex-base \
    texlive-fonts-recommended \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Stage 3: Set up the application environment inside the container.
# Create a directory for the app and set it as the working directory.
WORKDIR /app

# Stage 4: Install Node.js dependencies.
# Copy package.json and package-lock.json first. This leverages Docker's layer
# caching. If these files don't change, Docker won't re-run 'npm install'
# on subsequent builds, making them much faster.
COPY package*.json ./
RUN npm install

# Stage 5: Copy the rest of your application code into the container.
COPY . .

# Stage 6: Create the temporary directory required by your server for uploads.
# The 'chmod' command ensures the application has permission to write to it.
RUN mkdir -p server/tmp/uploads && chmod -R 777 server/tmp/uploads

# Stage 7: Document the port the application will run on.
# This is metadata and doesn't actually open the port.
EXPOSE 8080

# Stage 8: Define the command to run your application when the container starts.
CMD ["node", "server/server.js"]