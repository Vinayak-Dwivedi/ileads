#!/usr/bin/env bash
#
# Production Update & Database Migration Script
# -------------------------------------------------------------
# Designed to be run safely by a system administrator or manager
# to pull the latest changes, apply migrations, and reload the app.
#
# Usage:
#   bash deploy/update-deployment.sh
#

set -euo pipefail

# Text colors for clear output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}==================================================${NC}"
echo -e "${BLUE}       QMS Production Deployment Updater          ${NC}"
echo -e "${BLUE}==================================================${NC}"

# 1. Verify working directory
if [[ ! -f "package.json" || ! -d "prisma" ]]; then
    echo -e "${RED}ERROR: Script must be run from the root of the repository.${NC}"
    echo -e "Please run: cd /opt/qms (or your deployment folder) and then run this script."
    exit 1
fi

echo -e "${GREEN}[✓] Root directory verified: $(pwd)${NC}"

# 2. Identify deployment method (Docker vs PM2)
DEPLOY_MODE=""
if command -v docker &> /dev/null && docker compose ps &> /dev/null && [[ -f "docker-compose.yml" ]] && [[ $(docker compose ps -q | wc -l) -gt 0 ]]; then
    DEPLOY_MODE="DOCKER"
    echo -e "${GREEN}[✓] Detected active deployment mode: Docker Compose${NC}"
elif command -v pm2 &> /dev/null && pm2 list &> /dev/null; then
    DEPLOY_MODE="PM2"
    echo -e "${GREEN}[✓] Detected active deployment mode: PM2 (Process Manager)${NC}"
else
    echo -e "${YELLOW}[!] Warning: Could not auto-detect active PM2 or Docker Compose processes.${NC}"
    read -p "Choose deployment type manually (docker/pm2/cancel): " choice
    case "$choice" in
        docker|DOCKER) DEPLOY_MODE="DOCKER" ;;
        pm2|PM2) DEPLOY_MODE="PM2" ;;
        *) echo "Deployment aborted."; exit 1 ;;
    esac
fi

# 2b. Verify Environment Configuration (STT & LLM)
if [[ -f ".env" ]]; then
    echo -e "\n${YELLOW}Checking server environment configuration...${NC}"
    STT_PROV=$(grep -E '^STT_PROVIDER=' .env | tail -1 | sed -E 's/^STT_PROVIDER=//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/')
    SARVAM_KEY=$(grep -E '^SARVAM_API_KEY=' .env | tail -1 | sed -E 's/^SARVAM_API_KEY=//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/')
    OR_KEY=$(grep -E '^OPENROUTER_API_KEY=' .env | tail -1 | sed -E 's/^OPENROUTER_API_KEY=//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/')
    OR_MODEL=$(grep -E '^OPENROUTER_AUDIT_MODEL=' .env | tail -1 | sed -E 's/^OPENROUTER_AUDIT_MODEL=//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/')

    echo -e "  - Speech-To-Text Provider (STT_PROVIDER): ${BLUE}${STT_PROV:-(not set)}${NC}"
    if [[ "$STT_PROV" != "sarvam" ]]; then
        echo -e "    ${RED}[!] WARNING: STT_PROVIDER is not set to 'sarvam'. Currently: '${STT_PROV:-empty}'${NC}"
        echo -e "    ${YELLOW}If you want to use Sarvam AI, please edit .env to set: STT_PROVIDER=sarvam${NC}"
    else
        echo -e "    ${GREEN}[✓] STT Provider configured correctly to 'sarvam'${NC}"
    fi

    if [[ -n "$SARVAM_KEY" ]]; then
        echo -e "  - Sarvam API Key: ${GREEN}Configured${NC}"
    else
        echo -e "  - Sarvam API Key: ${RED}[!] Missing (Transcriptions will fail!)${NC}"
    fi

    echo -e "  - Audit Model (OPENROUTER_AUDIT_MODEL): ${BLUE}${OR_MODEL:-(not set)}${NC}"
    if [[ -n "$OR_KEY" ]]; then
        echo -e "  - OpenRouter API Key: ${GREEN}Configured${NC}"
    else
        echo -e "  - OpenRouter API Key: ${RED}[!] Missing (Auditing will fail!)${NC}"
    fi
else
    echo -e "${RED}[!] WARNING: .env file not found. Environment checks skipped.${NC}"
fi

# 3. Pull latest changes
echo -e "\n${YELLOW}Step 1: Pulling latest changes from Git...${NC}"

# Determine remote and branch
CURRENT_BRANCH=$(git branch --show-current)
echo -e "Current branch is: ${BLUE}${CURRENT_BRANCH}${NC}"

# Find which remote to pull from
REMOTE_NAME="upstream"
if ! git remote | grep -q "^upstream$"; then
    REMOTE_NAME="origin"
fi
echo -e "Configured remote is: ${BLUE}${REMOTE_NAME}${NC}"

# Perform safe git pull
git fetch "$REMOTE_NAME" "$CURRENT_BRANCH"
git status -uno

echo -e "\n${YELLOW}Would you like to pull the latest changes? (y/n)${NC}"
read -r pull_confirm
if [[ "$pull_confirm" =~ ^[Yy]$ ]]; then
    echo "Pulling latest updates..."
    git pull "$REMOTE_NAME" "$CURRENT_BRANCH" --ff-only
    echo -e "${GREEN}[✓] Successfully pulled latest updates.${NC}"
else
    echo "Skipping git pull. Proceeding with database migration using local files..."
fi

# 4. Apply Database Migrations
echo -e "\n${YELLOW}Step 2: Running database schema migrations...${NC}"
if [[ "$DEPLOY_MODE" == "DOCKER" ]]; then
    echo "Running migrations in Docker environment..."
    # If Docker, the container entrypoint runs migrations on start,
    # or we can invoke it inside the running container.
    # To be safe, we will run the migrate deploy command using npx locally on the host
    # using the database connection details.
    if [[ -f ".env" ]]; then
        export $(grep -v '^#' .env | xargs)
    fi
    npx prisma migrate deploy
else
    # PM2 mode: Run migrate deploy on host
    if [[ -f "deploy/redeploy.sh" ]]; then
        echo "Using redeploy.sh to apply updates safely..."
        # We will run redeploy with --no-build if they only want migration,
        # but running the full redeploy script is recommended to compile the latest code.
        echo -e "${YELLOW}Do you want to run the full redeployment (build + restart) or migration-only?${NC}"
        echo "1) Full Redeployment (recommended to avoid version mismatch)"
        echo "2) Database Migration Only"
        read -p "Select option (1/2): " redep_opt
        if [[ "$redep_opt" == "1" ]]; then
            bash deploy/redeploy.sh
            echo -e "${GREEN}[✓] Full redeployment complete.${NC}"
            exit 0
        else
            echo "Running prisma migration only..."
            npx prisma migrate deploy
        fi
    else
        npx prisma migrate deploy
    fi
fi
echo -e "${GREEN}[✓] Database migrations applied successfully.${NC}"

# 5. Build and Restart Services
echo -e "\n${YELLOW}Step 3: Reloading application services...${NC}"
if [[ "$DEPLOY_MODE" == "DOCKER" ]]; then
    echo "Rebuilding and restarting Docker containers..."
    docker compose up -d --build
    echo -e "${GREEN}[✓] Docker containers rebuilt and restarted.${NC}"
else
    echo "Reloading application under PM2..."
    if [[ -f "ecosystem.config.js" ]]; then
        pm2 reload ecosystem.config.js --update-env
        pm2 save
        echo -e "${GREEN}[✓] PM2 services reloaded.${NC}"
    else
        echo -e "${RED}ERROR: ecosystem.config.js not found. Cannot reload PM2.${NC}"
    fi
fi

# 6. Verification
echo -e "\n${YELLOW}Step 4: Performing service health checks...${NC}"
sleep 3

# Read port and basepath from .env
BASE_PATH="/ileads-qms"
if [[ -f ".env" ]]; then
    ENV_BASE_PATH=$(grep -E '^NEXT_PUBLIC_BASE_PATH=' .env | tail -1 | sed -E 's/^NEXT_PUBLIC_BASE_PATH=//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/')
    if [[ -n "$ENV_BASE_PATH" ]]; then
        BASE_PATH="$ENV_BASE_PATH"
    fi
fi

echo -e "Verifying local service endpoints..."
STATUS_CODE=$(curl -o /dev/null -s -w "%{http_code}" http://127.0.0.1:3010${BASE_PATH}/login || true)

if [[ "$STATUS_CODE" == "200" || "$STATUS_CODE" == "307" || "$STATUS_CODE" == "302" ]]; then
    echo -e "${GREEN}[✓] Health check passed! HTTP Status Code: $STATUS_CODE${NC}"
    echo -e "${GREEN}App is running and accessible at http://127.0.0.1:3010${BASE_PATH}${NC}"
else
    echo -e "${YELLOW}[!] Warning: Health check returned status code: $STATUS_CODE.${NC}"
    echo -e "Please check logs using: ${BLUE}pm2 logs${NC} or ${BLUE}docker compose logs${NC}"
fi

echo -e "\n${GREEN}==================================================${NC}"
echo -e "${GREEN}     Update and migration complete successfully!   ${NC}"
echo -e "${GREEN}==================================================${NC}"
