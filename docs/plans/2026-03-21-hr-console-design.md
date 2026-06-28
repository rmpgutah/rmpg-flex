# HR Console — Design Document

**Date:** 2026-03-21
**Status:** Approved
**Route:** `/hr`
**Access:** Everyone sees their own data; managers/admins see org-wide

## Overview

A new top-level HR Console page (`/hr`) providing a full HR management suite:
dashboard, leave/PTO management, disciplinary records, and performance reviews.
Separate from the existing Personnel page which focuses on operational field tasks
(scheduling, deployment, duty board, equipment).

## Architecture

**Approach: Tab-Per-File Module** — lightweight shell `HRPage.tsx` (~200 lines)
renders tab components from `client/src/pages/hr/tabs/`. Backend uses
`server/src/routes/hr.ts` with new database tables. Reuses existing `users` table
via JOINs.

```
client/src/pages/hr/
  HRPage.tsx              — Shell with tab navigation
  tabs/
    HRDashboardTab.tsx    — Overview metrics and pending items
    LeaveTab.tsx          — PTO requests and balances
    DisciplinaryTab.tsx   — Warnings, suspensions, commendations
    ReviewsTab.tsx        — Performance reviews and ratings
  modals/
    LeaveRequestModal.tsx — Create/edit leave request
    DisciplinaryFormModal.tsx — Create/edit disciplinary record
    ReviewFormModal.tsx   — Create/edit performance review
  utils/
    hrConstants.ts        — Types, colors, categories
    hrFormatters.ts       — Rating display, date helpers

server/src/routes/hr.ts   — All HR API endpoints
server/src/models/database.ts — New table definitions (migrations)
```

## Database Schema

### leave_requests
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| officer_id | INTEGER FK→users | Required |
| type | TEXT | CHECK: vacation, sick, personal, bereavement, training, unpaid |
| start_date | TEXT | ISO date |
| end_date | TEXT | ISO date |
| hours_requested | REAL | Calculated from date range |
| reason | TEXT | Optional |
| status | TEXT | CHECK: pending, approved, denied, cancelled |
| reviewed_by | INTEGER FK→users | NULL until reviewed |
| reviewed_at | TEXT | NULL until reviewed |
| review_notes | TEXT | Approver comments |
| created_at | TEXT | ISO timestamp |
| updated_at | TEXT | ISO timestamp |

### leave_balances
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| officer_id | INTEGER FK→users | Required |
| year | INTEGER | e.g. 2026 |
| vacation_total | REAL | Hours allocated |
| vacation_used | REAL | Hours used |
| sick_total | REAL | Hours allocated |
| sick_used | REAL | Hours used |
| personal_total | REAL | Hours allocated |
| personal_used | REAL | Hours used |
| created_at | TEXT | ISO timestamp |
| updated_at | TEXT | ISO timestamp |

**Unique constraint:** (officer_id, year)

### disciplinary_records
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| officer_id | INTEGER FK→users | Required |
| type | TEXT | CHECK: verbal_warning, written_warning, suspension, termination, commendation, counseling |
| severity | TEXT | CHECK: minor, moderate, major, critical |
| incident_date | TEXT | ISO date |
| description | TEXT | Required |
| action_taken | TEXT | What was done |
| follow_up_date | TEXT | NULL if no follow-up needed |
| follow_up_notes | TEXT | Follow-up outcome |
| status | TEXT | CHECK: open, closed, appealed |
| issued_by | INTEGER FK→users | Manager who created |
| witness | TEXT | Optional witness name |
| attachments | TEXT | JSON array of file paths |
| created_at | TEXT | ISO timestamp |
| updated_at | TEXT | ISO timestamp |

### performance_reviews
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| officer_id | INTEGER FK→users | Required |
| reviewer_id | INTEGER FK→users | Required |
| review_period_start | TEXT | ISO date |
| review_period_end | TEXT | ISO date |
| review_date | TEXT | ISO date |
| type | TEXT | CHECK: annual, probationary, quarterly, improvement_plan |
| overall_rating | INTEGER | 1-5 |
| categories | TEXT | JSON object {category: rating} |
| strengths | TEXT | Narrative |
| areas_for_improvement | TEXT | Narrative |
| goals | TEXT | Narrative |
| officer_comments | TEXT | Officer's acknowledgment notes |
| status | TEXT | CHECK: draft, submitted, acknowledged, completed |
| acknowledged_at | TEXT | NULL until officer acknowledges |
| created_at | TEXT | ISO timestamp |
| updated_at | TEXT | ISO timestamp |

## Tab Designs

### 1. Dashboard Tab (landing)

**Manager/Admin view:**
- Headcount cards: total active, new hires (30d), terminations (30d), on leave today
- Compliance ring charts: training %, credential %, overdue count
- Leave calendar: mini calendar showing who's out today/this week
- Pending approvals badge: leave requests awaiting action (clickable → Leave tab)
- Recent HR activity: last 10 disciplinary actions, reviews, leave approvals

**Officer self-service view:**
- PTO balance cards: vacation, sick, personal days remaining
- Next review date + reviewer
- Expiring credentials within 90 days
- Quick action: "Request Time Off" button

### 2. Leave/PTO Tab

**Officer view:**
- Balance cards with visual progress bars per type
- "Request Time Off" form: date range picker, type dropdown, reason
- Request history with status badges
- Cancel pending requests

**Manager view:**
- Pending approvals list with approve/deny + notes
- Team calendar with conflict detection
- Balance overview table for all reports
- Bulk approve capability
- Override balances (admin only)

### 3. Disciplinary Tab

**Manager/Admin view:**
- Record list with severity color coding and type icons
- Create form: officer picker, type, severity, description, action, follow-up date
- Filter by officer, type, severity, status, date range
- Timeline view per officer (chronological)
- Follow-up reminders for upcoming dates
- Commendations section (separate positive treatment)

**Officer view:**
- Own records (read-only)
- Commendations shown prominently
- Cannot see who reported/witnessed (privacy)

**Access:** Only admin/manager can create/edit. Supervisors view their team only.

### 4. Performance Reviews Tab

**Manager/Admin view:**
- Review list with rating badges and status
- Create/edit form: officer, period, category ratings (1-5 stars), narratives
- Dashboard: upcoming/overdue reviews, average ratings by department
- Bulk schedule reviews

**Officer view:**
- Completed reviews (read-only)
- Add acknowledgment comment + sign off
- Rating trend chart over time

**Default review categories:**
Professionalism, Communication, Tactical Skills, Leadership,
Attendance/Punctuality, Report Writing, Community Relations, Policy Compliance

## API Endpoints

### Leave
- `GET /api/hr/leave` — List requests (filtered by officer/status/date)
- `POST /api/hr/leave` — Submit request
- `PUT /api/hr/leave/:id` — Update request
- `POST /api/hr/leave/:id/approve` — Approve (manager+)
- `POST /api/hr/leave/:id/deny` — Deny (manager+)
- `DELETE /api/hr/leave/:id` — Cancel own pending request
- `GET /api/hr/leave/balances` — Get balances (own or team)
- `PUT /api/hr/leave/balances/:id` — Override balance (admin)

### Disciplinary
- `GET /api/hr/disciplinary` — List records (filtered)
- `GET /api/hr/disciplinary/:officerId/timeline` — Officer timeline
- `POST /api/hr/disciplinary` — Create record (admin/manager)
- `PUT /api/hr/disciplinary/:id` — Update record (admin/manager)
- `DELETE /api/hr/disciplinary/:id` — Delete record (admin)

### Reviews
- `GET /api/hr/reviews` — List reviews (filtered)
- `POST /api/hr/reviews` — Create review (manager+)
- `PUT /api/hr/reviews/:id` — Update review (manager+)
- `POST /api/hr/reviews/:id/acknowledge` — Officer acknowledges
- `DELETE /api/hr/reviews/:id` — Delete draft (admin)

### Dashboard
- `GET /api/hr/dashboard` — Aggregated metrics for dashboard tab

## Navigation

- New top-level route: `/hr`
- Added to desktop toolbar under existing menu structure
- Added to mobile drawer under Personnel section
- F-key shortcut: evaluate available slot
- Role-based: all authenticated users can access; content filtered by role

## Visual Design

Follows existing RMPG Flex design system:
- Surface colors: #141e2b (base), #1a2636 (raised), #0d1520 (sunken)
- Brand blue: #1a5a9e, Brand gold: #d4a017
- Border radius: 2px (flat retro console)
- Tab bar matches Personnel page pattern
- Cards use panel-beveled class
- Status badges use existing color patterns from personnelConstants
