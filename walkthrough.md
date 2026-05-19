# Walkthrough - Implement Add Agent Feature

We have implemented the backend database structures, server actions, and frontend modal UI for the **Add Agent** feature.

## Changes Made

### 1. Database Schema
* Modified [prisma/schema.prisma](file:///e:/ileads/prisma/schema.prisma) to add a `campaignId` field and corresponding relationships on the `Agent` and `Campaign` models.
* Re-generated the Prisma Client and verified that the PostgreSQL schema was updated successfully.

### 2. Backend Server Actions
* Added `addAgent` to [src/app/(app)/parameters/actions.ts](file:///e:/ileads/src/app/%28app%29/parameters/actions.ts). This handles:
  * Fetching the active user session client ID.
  * Validating inputs (Agent Name, Agent ID).
  * Checking for duplicate Agent IDs for the same client.
  * Storing the agent under the active client, mapping the optional campaign.
  * Revalidating the main paths (`/dashboard` and `/calls`) to ensure all dropdown boxes update instantly.

### 3. Frontend Components & Layout
* **Sidebar Update:**
  * Updated [src/features/dashboard-01/components/nav-main.tsx](file:///e:/ileads/src/features/dashboard-01/components/nav-main.tsx) to support custom clickable submenu items with `onClick` callbacks.
  * Updated [src/features/dashboard/components/app-sidebar.tsx](file:///e:/ileads/src/features/dashboard/components/app-sidebar.tsx) to pass client campaigns dynamically and add the **Add Agent** button under "Parameters".
* **Add Agent Modal:**
  * Created [src/components/layout/add-agent-dialog.tsx](file:///e:/ileads/src/components/layout/add-agent-dialog.tsx) containing a form with fields for Agent Name, Agent ID, and Campaign dropdown.

## Verification
* Run type checks via `npx tsc --noEmit` and verified 100% type safety.
* Tested the database operations using a script to confirm agent insertion and campaign linking.
* UI has been styled following the premium design guidelines.
