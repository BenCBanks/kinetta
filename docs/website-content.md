# Editing the website

The website's written headings, paragraphs and simple lists live in **`site/content/*.md`**, one file per page.
For example, edit [the homepage copy](../site/content/index.md) on GitHub using its pencil button. Change the prose
below a `## section-key` heading; keep the keys. Markdown supports **bold**, *emphasis*, `code` and links.
Commit the edit through a pull request. When it merges, GitHub Pages automatically builds and publishes the content.
These website-only edits do not require an iPhone build or database change.

HTML layout stays in `site/templates/`; generated ready-to-serve pages stay in `site/`. Do not edit generated prose
in `site/index.html`, because the next publication will replace it. Navigation/control labels, image captions that
contain styled spans, screenshot descriptions and metadata remain in templates; ask for a layout/metadata change
or edit the template when changing these. The feature guide's 36 how-to entries remain sourced from the app catalog
in `app/static/explore.js`, so website and app cannot silently disagree.

Preview locally with:

```sh
python3 dev/design/build_content.py
python3 -m http.server 8080 --directory site
```

Open `http://localhost:8080`. The build requires Python 3 and Node.js, with no package installation. It validates
section keys, escapes raw HTML, allows safe local/web/mail links and refreshes the public feature catalog. CI also
builds the content, and every Pages publish runs the builder. Screenshots continue refreshing through their existing
separate workflow. Changing a screenshot does not change the written Markdown.

## Beta requests and contact email

The Join the beta button opens the hosted `/beta` form. Requests are stored in the private admin-only queue under
Me → People → Beta requests. They do not currently send email to the owner or automatically create an account.
Invite creates a one-use link and prepares a `mailto:` message for the owner to send from their email client.
The confirmation and form both link back to `https://kinetta.app/`.

A branded email address can be added once it exists. Automatic sending would additionally need a configured email
provider/SMTP and verified sender; do not claim mail was sent from the current form or guess an uncreated address.
