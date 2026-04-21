# PillSeek Admin Guide

This guide covers day-to-day use of the PillSeek admin dashboard at `/admin`.

---

## Table of Contents
1. [How to log in (magic link)](#1-how-to-log-in)
2. [Role explanations](#2-role-explanations)
3. [How to edit a pill](#3-how-to-edit-a-pill)
4. [How drafts + publish work](#4-how-drafts--publish-work)
5. [How to upload an image](#5-how-to-upload-an-image)
6. [How to restore a deleted pill](#6-how-to-restore-a-deleted-pill)
7. [How to add a new admin user](#7-how-to-add-a-new-admin-user)
8. [Critical-field policy](#8-critical-field-policy)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. How to Log In

The admin dashboard uses **magic link** authentication — no passwords required.

1. Navigate to `https://pillseek.com/admin/login` (or your deployment URL + `/admin/login`)
2. Enter your email address
3. Click **"Send magic link"**
4. You will see a confirmation screen: _"Check your email"_
5. Open your email and click the magic link
6. You will be redirected to the admin dashboard `/admin`

> **Note:** Magic links expire after 1 hour. If you click an expired link, return to `/admin/login` and request a new one.

---

## 2. Role Explanations

| Role | What you can do |
|------|----------------|
| **superadmin** | Everything: manage other admin users, view all data, perform any action, hard delete (future) |
| **editor** | Create pills, edit non-critical fields, upload images, save drafts, soft delete |
| **reviewer** | All editor abilities + edit critical medical fields, approve/reject/publish drafts |
| **readonly** | View the dashboard, pills list, audit log — no writes |

Your role is shown in the top-right of the dashboard.

---

## 3. How to Edit a Pill

1. Click **Pills** in the sidebar
2. Use the search box to find the pill by name, imprint, or NDC
3. Click on the pill name or **Edit** button to open the edit form
4. The form is divided into sections:
   - **Identification** — medicine name, imprint, color, shape
   - **Medical** — strength, ingredients, dosage form, route *(reviewer required for these)*
   - **Codes** — NDC, RxCUI
   - **Status** — Rx/OTC status, imprint status
   - **SEO** — slug, meta description
   - **Image** — upload/replace/delete image

5. Make your changes
6. Choose an action at the bottom:
   - **Save as Draft** — saves changes privately, not visible on public site
   - **Submit for Review** — sends to reviewer queue
   - **Publish Now** *(reviewer+ only)* — applies changes immediately to the public site

> Fields marked with a 🔒 **"Reviewer Required"** badge require reviewer-or-higher role. If you're an editor, you must save as draft and submit for review.

---

## 4. How Drafts + Publish Work

The workflow ensures critical medical content is reviewed before going live.

```
Editor opens pill
  → makes changes
  → clicks "Save as draft"
      → pill_drafts row created (status = draft)
  → OR clicks "Submit for review"
      → status = pending_review
      → reviewers see badge in /admin/drafts

Reviewer opens /admin/drafts
  → sees list of pending_review drafts
  → opens a draft → sees diff (before/after)
  → clicks "Approve" → status = approved
  → clicks "Publish" → changes applied to pillfinder, status = published
  → OR clicks "Reject" with notes → status = rejected, editor is notified
```

Reviewers can approve + publish in one action.

---

## 5. How to Upload an Image

1. Navigate to the pill edit page (`/admin/pills/[id]`)
2. Scroll to the **Image** section at the bottom of the form
3. Click **"Choose file"** and select a `.jpg`, `.png`, or `.webp` file
4. Maximum size: **5 MB**
5. Click **"Upload Image"**
6. The new image will appear in the preview immediately
7. The change is saved automatically (does not require a draft)

Images are stored in Supabase Storage under `pill-images/{pill_id}/`.

To **delete** an image:
1. Click the **"Delete image"** button next to the image preview
2. Confirm the action
3. The image is moved to a `deleted/` prefix in Storage (not hard-deleted)

---

## 6. How to Restore a Deleted Pill

Deleted pills are soft-deleted — they are hidden from the public site but not removed from the database.

1. Click **Trash** in the sidebar
2. Find the pill you want to restore
3. Click **"Restore"**
4. The pill will reappear in the main Pills list and on the public site

> Only **superadmin** users can permanently delete (hard delete) a pill. This is not available in the current UI (future feature).

---

## 7. How to Add a New Admin User

Only **superadmin** users can invite new admins.

1. Click **Users** in the sidebar (only visible to superadmins)
2. Click **"Invite User"**
3. Enter the email address and select a role
4. Click **"Send Invite"**
5. The new user will receive a magic link email to set up their account
6. Once they click the link, they can access the admin dashboard

To **change a role** or **deactivate** a user:
1. Find the user in the list
2. Click **"Edit"** next to their name
3. Change the role using the dropdown, or toggle **"Active"** off to deactivate

---

## 8. Critical-Field Policy

The following fields contain medical information and require **reviewer or superadmin** role to edit directly. Editors must use the draft workflow for these fields:

| Field | Why It's Critical |
|-------|------------------|
| `spl_strength` | Dosage strength — affects patient safety |
| `spl_ingredients` | Active ingredients — allergy risk |
| `dea_schedule_name` | Controlled substance status — legal implications |
| `pharmclass_fda_epc` | FDA pharmacologic class |
| `dosage_form` | Tablet, capsule, liquid, etc. |
| `route` | Oral, topical, injectable, etc. |

If you are an editor and need to change one of these fields:
1. Make the change in the edit form
2. Click **"Save as Draft"** (the form will warn you it needs review)
3. Click **"Submit for Review"**
4. A reviewer will approve and publish it

---

## 9. Troubleshooting

### Magic link didn't arrive
- Check your spam/junk folder
- Wait 2 minutes — email delivery can be delayed
- Try requesting a new link at `/admin/login`
- Ensure you're using the exact email address associated with your admin account
- Contact a superadmin to verify your email is in the `admin_users` table

### "Not an admin user" error after clicking magic link
You authenticated successfully with Supabase, but your email is not in the `admin_users` table. Contact a superadmin to add you.

### "Account is deactivated" error
Your admin account has been deactivated. Contact a superadmin.

### "Someone else edited this — refresh to see changes" (409 error)
Another admin edited the same pill while you had the form open. Refresh the page, review the latest changes, and reapply your edits.

### Changes not appearing on the public site
- If you used "Save as Draft", the change is not published yet. Submit for review and have a reviewer publish it.
- If you used "Publish Now" or a reviewer published it, it may take a few seconds for caches to clear. Hard refresh the public pill page.

### Image not appearing after upload
- Check that the Supabase Storage bucket is correctly configured (`STORAGE_BUCKET` env var)
- Verify `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set correctly
- Images must be `.jpg`, `.png`, or `.webp` and under 5 MB
