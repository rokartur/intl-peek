# Change Log

## 0.1.1
- A missing key in the Translations view opens the file of its own locale, at the group where the key belongs, instead of the default locale's file.
- Missing keys show the default locale's value next to them.
- New `+` button on a missing key: it writes the key with the default locale's value into that locale's file and selects the value, so you can type the translation and save.

## 0.1.0
- First release. Translations replace their keys in `t('...')` calls, in gray, and the key comes back on the line with the cursor.
- Hover with the value in every locale, go to definition into the message file, key completion inside `t('...')`, and a warning for a key missing in any locale.
- Translations section in the Explorer: each locale with its flag, its name in its own language and how many keys of the default locale it has. Expand a locale to see its missing keys.
- `intl-peek.displayLocale` `pl` also matches `pl-PL` and `pl_PL`.
