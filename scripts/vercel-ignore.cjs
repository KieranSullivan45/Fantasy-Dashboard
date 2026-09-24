// The append-only data branch is read by the app, never deployed as an app revision.
process.exit(process.env.VERCEL_GIT_COMMIT_REF === "data-archive" ? 0 : 1);
