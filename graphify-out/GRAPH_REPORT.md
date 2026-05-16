# Graph Report - qms_demo  (2026-05-16)

## Corpus Check
- 101 files · ~57,311 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 565 nodes · 929 edges · 35 communities (25 shown, 10 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 7 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]

## God Nodes (most connected - your core abstractions)
1. `requireSession()` - 32 edges
2. `cn()` - 30 edges
3. `Deployment Runbook - `http://187.127.139.47/ileads-qms`` - 17 edges
4. `compilerOptions` - 16 edges
5. `dependencies` - 15 edges
6. `withBasePath()` - 15 edges
7. `devDependencies` - 13 edges
8. `scripts` - 12 edges
9. `QMS - Quality Management System` - 12 edges
10. `validateAuditResponse()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `cn()` --calls--> `clsx`  [INFERRED]
  src/lib/utils.ts → package.json
- `runMockTranscription()` --calls--> `runMockTranscriptionForCall()`  [INFERRED]
  src/app/(app)/calls/[id]/actions.ts → src/services/transcription/runMockTranscriptionForCall.ts
- `parseFilters()` --calls--> `GET()`  [INFERRED]
  src/app/(app)/dashboard/page.tsx → src/app/api/calls/[callId]/audio/route.ts
- `parseInput()` --calls--> `GET()`  [INFERRED]
  src/app/(app)/parameters/actions.ts → src/app/api/calls/[callId]/audio/route.ts
- `parseFilters()` --calls--> `GET()`  [INFERRED]
  src/app/(app)/calls/page.tsx → src/app/api/calls/[callId]/audio/route.ts

## Communities (35 total, 10 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.08
Nodes (31): ClientInput, parse(), slugify(), toggleClientActive(), upsertClient(), ClientRow, ClientsEditor(), ClientsPage() (+23 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (40): CallsPage(), parseFilters(), buildWhere(), CALL_STATUS_VALUES, CallDetail, CallListFilters, CallListItem, CallUploadOptions (+32 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (32): CallsFilterBar(), Initial, Options, toDateInput(), CallUploadOptions, formatBytes(), UploadCallsDialog(), cn() (+24 more)

### Community 3 - "Community 3"
Cohesion: 0.04
Nodes (45): dependencies, bcryptjs, class-variance-authority, clsx, lucide-react, next, @prisma/client, @radix-ui/react-dialog (+37 more)

### Community 4 - "Community 4"
Cohesion: 0.04
Nodes (44): 10. Build Next.js With Base Path, 11. Start App With PM2, 12. Configure Nginx, 13. Verify Public URL, 14. Restart Commands, 15. Logs and Troubleshooting, 1. Install System Packages, 2. Install Node.js LTS (+36 more)

### Community 5 - "Community 5"
Cohesion: 0.11
Nodes (34): buildAuditPrompt(), fmt(), getClientAuditParameters(), generateMockAuditResponse(), runAuditForCall(), RunAuditOptions, RunAuditResult, SaveAuditOptions (+26 more)

### Community 6 - "Community 6"
Cohesion: 0.12
Nodes (20): DashboardFilterBar(), Initial, Options, toDateInput(), DashboardPage(), parseFilters(), buildCallWhere(), DashboardFilters (+12 more)

### Community 7 - "Community 7"
Cohesion: 0.07
Nodes (30): AI Pipeline Status, Audio Uploads, Base Path, code:text (http://187.127.139.47/ileads-qms), code:bash (bash deploy/deploy-direct.sh --seed), code:bash (sudo bash deploy/install-nginx-direct.sh), code:bash (pm2 status), code:bash (NEXT_PUBLIC_BASE_PATH=/ileads-qms npm run build) (+22 more)

### Community 8 - "Community 8"
Cohesion: 0.1
Nodes (35): AppLayout(), MobileNav(), nav, nav, Sidebar(), attemptPasswordLogin(), AuthenticatedSession, clearSessionCookie() (+27 more)

### Community 9 - "Community 9"
Cohesion: 0.1
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 10 - "Community 10"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 11 - "Community 11"
Cohesion: 0.14
Nodes (14): 1. Files converted, 2. Routes that now contain the converted UI, 3. Confirmation that `/html` is not required, 4. Visual differences vs. the original mocks, 5. Verification commands, 5. Visual comparison checklist, 6. Verification commands, Call Detail (+6 more)

### Community 12 - "Community 12"
Cohesion: 0.24
Nodes (4): LiveSttNotConfiguredProvider, SttProvider, SttResult, SttSegment

### Community 13 - "Community 13"
Cohesion: 0.36
Nodes (6): generateMockTranscript(), SEGMENTS, runMockTranscriptionForCall(), saveTranscript(), TranscriptResult, TranscriptSegmentInput

### Community 14 - "Community 14"
Cohesion: 0.29
Nodes (6): AI audit pipeline, code:block1 (audio file), Files, Hard contracts, What is NOT implemented in this scaffold, When live STT + Gemma are wired

### Community 15 - "Community 15"
Cohesion: 0.67
Nodes (3): daysAgo(), main(), prisma

### Community 31 - "Community 31"
Cohesion: 0.18
Nodes (18): GET(), Params, streamFile(), ACCEPTED_AUDIO_EXTENSIONS, AUDIO_CONTENT_TYPES, buildStoredAudioFileName(), contentTypeForAudioPath(), getAudioExtension() (+10 more)

### Community 32 - "Community 32"
Cohesion: 0.25
Nodes (7): SelectContent, SelectItem, SelectLabel, SelectScrollDownButton, SelectScrollUpButton, SelectSeparator, SelectTrigger

### Community 33 - "Community 33"
Cohesion: 0.38
Nodes (6): AUDIO_EXTENSIONS, audioRoot(), externalIdFor(), main(), MIME_TYPES, prisma

### Community 34 - "Community 34"
Cohesion: 0.25
Nodes (7): Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow

## Knowledge Gaps
- **229 isolated node(s):** `name`, `version`, `private`, `dev`, `build` (+224 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `cn()` connect `Community 2` to `Community 0`, `Community 1`, `Community 34`, `Community 32`, `Community 3`, `Community 6`, `Community 8`?**
  _High betweenness centrality (0.120) - this node is a cross-community bridge._
- **Why does `clsx` connect `Community 3` to `Community 2`?**
  _High betweenness centrality (0.092) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _229 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.04 - nodes in this community are weakly interconnected._