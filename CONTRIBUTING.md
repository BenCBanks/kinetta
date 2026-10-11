# Contributing to Lankki

Thanks for wanting to help! Lankki is a small project, so please **open an issue before writing a large change**, so we
can agree on the idea first. Bug reports, ideas and questions are all welcome as issues.

When you send a pull request:
- Keep the privacy rules: every API endpoint reads and writes only the logged-in person's rows (`current_user` +
  `WHERE user_id`), and every new personal table gets row-level security (see `app/db.py`).
- Database changes are new entries at the end of `MIGRATIONS` in `app/db.py`; never edit one that has shipped.
- The phone app has no build step: edit `app/static/`, then bump the `?v=` numbers in `index.html`.
- Test with throwaway accounts on your own install, never with real people's data.

Contributions are accepted under the project's license (AGPL-3.0). Because the author may also offer Lankki under a
commercial license, you may be asked to sign a short contributor agreement before a larger contribution is merged.
