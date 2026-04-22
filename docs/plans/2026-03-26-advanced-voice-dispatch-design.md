# Advanced Voice Dispatch System — Design

**Date:** 2026-03-26
**Status:** Approved

## Overview

Comprehensive upgrade to the voice dispatch system across 5 pillars: Officer Safety Intelligence, Conversational AI, Tactical Dispatch Automation, Full Data Integration, and Voice Analysis. Transforms the system from reactive alerts to proactive, AI-powered dispatch intelligence.

**AI Provider:** Groq (Llama 3.3 70B) — fastest inference for real-time dispatch.

---

## 1. Officer Safety Intelligence

### 1A. Contextual Threat Briefings
Cross-reference call data against: premise history, subject criminal records, gang affiliations, warrant status, field interview cards, trespass orders, and similar incident patterns. Weave into spoken narrative.

### 1B. Safety Gates
Critical flag combos (weapons + felony, pursuit, officer safety caution) pause dispatch and require spoken "Confirm" before proceeding.

### 1C. Panic Recovery Protocol
2-minute status check after panic. No response at 3 minutes = supervisor escalation. 5 minutes = all-units welfare broadcast.

### 1D. Real-Time Warrant Hit Announcements
Interrupt current voice to announce warrant hits during live calls with subject name, charge, bail amount.

### 1E. Voice Stress Analysis
Analyze pitch elevation (>20% above baseline), speech rate acceleration (>30% faster), breathing irregularity. Auto-escalate severity + notify supervisor.

### 1F. GPS Proximity Danger Alerts
Background check GPS updates against: sex offender residences, prior shooting locations, gang territory. Voice warn when within 200ft.

### 1G. Officer Welfare Auto-Check
P1/P2 calls: 15 min no update → voice prompt. No response at 2 min → supervisor. No response at 5 min → all-units broadcast.

---

## 2. Conversational AI Engine

### 2A. AI-Powered NLU
Replace regex fallback with Groq LLM for unrecognized commands. Parse free-form speech into structured dispatch actions.

### 2B. Multi-Turn Conversations
3-exchange memory. Confirmation prompts for critical actions. Follow-up questions to gather missing details (situation type, priority, location specifics).

### 2C. Voice-Driven Call Creation
Full call creation from natural speech: incident type, location, suspect/vehicle description, priority auto-classified. Read back for confirmation.

### 2D. Witness Statement Transcription
"Start statement" activates continuous transcription mode. Speech appended to call narrative. "End statement" stops. Timestamped entries.

### 2E. Contextual Help / Disambiguation
Low confidence (<60%): ask for clarification. Very low (<40%): list available commands. High false-positive words ("copy" in conversation) require context check.

---

## 3. Tactical Dispatch Automation

### 3A. Nearest Unit GPS Suggestions
Haversine distance from call location to all available unit GPS positions. Voice announces top 3 with distance and ETA.

### 3B. Smart Auto-Dispatch Recommendations
AI considers proximity + specialization + workload + call type to recommend best unit assignment.

### 3C. Shift Handoff Briefings
Configurable time trigger. Auto-compose summary: calls handled, arrests, pursuits, open calls carrying over, unit status.

### 3D. Cross-Channel Coordination
No response to backup on DISPATCH after 30s → auto-broadcast to TAC-1. Another 30s → all channels.

### 3E. Workload Balancing Alerts
Officer with >3 active calls + others available → voice suggests redistribution.

### 3F. Pursuit Coordination
Auto-update every 30s with GPS position, speed, heading, cross streets, nearest intercept unit.

---

## 4. Full Data Integration

### 4A. Case Management Voice Queries
"Status of case X" → reads case info. "Link this call to case X" → creates association.

### 4B. Integration Health Alerts
Critical system offline (warrants, GPS, jail roster) → voice warning to all units.

### 4C. Field Interview Cross-Reference
Auto-check subjects against FI history. Announce contact count and last encounter details.

### 4D. Trespass Order Alerts
GPS at property with active trespass → announce subject name, ban expiry, arrest authority.

---

## 5. Architecture

### New Files
- `server/src/utils/threatContext.ts` — DB queries for threat/safety context
- `server/src/utils/voiceNLU.ts` — Groq-powered natural language understanding
- `server/src/utils/proximityAlerts.ts` — GPS danger proximity checks
- `server/src/utils/officerWelfare.ts` — Welfare check timers + escalation
- `server/src/utils/shiftBriefing.ts` — Shift handoff summary generator
- `server/src/utils/pursuitTracker.ts` — Real-time pursuit GPS coordination
- `client/src/utils/stressAnalyzer.ts` — Voice pitch/rate stress detection
- `client/src/utils/conversationMemory.ts` — Multi-turn conversation state
- `client/src/utils/statementRecorder.ts` — Witness statement transcription

### Modified Files
- `server/src/routes/voice.ts` — NLU fallback, conversation context, statement mode, safety gates
- `server/src/routes/dispatch/calls.ts` — Broadcast threat context with calls
- `server/src/routes/dispatch/callActions.ts` — Safety gate confirmations
- `client/src/utils/voiceChannel.ts` — Conversation state, statement mode, stress hooks, welfare checks
- `client/src/utils/narrativeComposer.ts` — Threat context in narratives, proximity warnings
- `client/src/hooks/useDispatchVoiceAlerts.ts` — New event types, proximity alerts, welfare prompts
- `client/src/components/VoiceChannelIndicator.tsx` — Conversation mode, statement recording, stress indicator
