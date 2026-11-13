# Change Log

## 0.1.0
- First release. Translations replace their keys in `t('...')` calls, in gray, and the key comes back on the line with the cursor.
- Hover with the value in every locale, go to definition into the message file, key completion inside `t('...')`, and a warning for a key missing in any locale.
- Translations section in the Explorer: each locale with its flag, its name in its own language and how many keys of the default locale it has. Expand a locale to see its missing keys.
- `intl-peek.displayLocale` `pl` also matches `pl-PL` and `pl_PL`.
