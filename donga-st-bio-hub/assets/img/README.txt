LOGO SLOT
=========

Put the official Dong-A ST artwork here as:

    logo.svg          <-- preferred

Every page looks for `assets/img/logo.svg`. If the file exists it is used
automatically and the built-in placeholder mark is removed. If it is missing,
the placeholder renders instead. Never both.

Using a PNG/JPG instead
-----------------------
Change LOGO_SRC at the top of assets/js/shell.js:

    const LOGO_SRC = "assets/img/logo.png";

and update the two <img src> references in index.html (the login page does not
use shell.js because it renders before a session exists).

Sizing
------
The mark is rendered into a 30x30 box in the sidebar and 34x34 on the login
screen, with `object-fit: contain`. A square or near-square crop of the emblem
works best. If your asset is the full horizontal lockup (emblem + 동아에스티
wordmark), remove the adjacent text spans in shell.js so the name is not
duplicated.
