export type KeyRef = { key: string; start: number; end: number }

const TRANSLATOR = String.raw`(?:useTranslations|getTranslations|useTranslate|createTranslator)`
const QUOTED_NS = String.raw`(['"\x60])([\w.-]*)\2`
const OBJECT_NS = String.raw`\{[^}]*?\bnamespace\s*:\s*(['"\x60])([\w.-]*)\4`
const BINDING = new RegExp(
	String.raw`\b(?:const|let|var)\s+([\w$]+)\s*=\s*(?:await\s+)?${TRANSLATOR}\s*\(\s*(?:${QUOTED_NS}|${OBJECT_NS})?`,
	'g',
)
const METHOD = String.raw`(?:\.(?:rich|markup|raw|has))?`
const KEY_BEING_TYPED = new RegExp(String.raw`(?<![\w$.])([\w$]+)${METHOD}\(\s*['"\x60]([\w.-]*)$`)

type Binding = { name: string; namespace: string; offset: number }

function findBindings(text: string) {
	const bindings: Binding[] = []
	for (const m of text.matchAll(BINDING)) bindings.push({ name: m[1], namespace: m[3] ?? m[5] ?? '', offset: m.index })
	return bindings
}

// The nearest binding above wins, so two components in one file can each bind `t` to their own namespace.
function namespaceAt(bindings: Binding[], name: string, offset: number) {
	let namespace: string | undefined
	for (const binding of bindings) {
		if (binding.offset >= offset) break
		if (binding.name === name) namespace = binding.namespace
	}
	return namespace
}

const join = (namespace: string, key: string) => (namespace ? `${namespace}.${key}` : key)

export function findKeyRefs(text: string) {
	const bindings = findBindings(text)
	const names = [...new Set(bindings.map((b) => b.name.replaceAll('$', '\\$')))]
	if (!names.length) return []

	const call = new RegExp(String.raw`(?<![\w$.])(${names.join('|')})${METHOD}\(\s*(['"\x60])([\w.-]+)\2`, 'g')
	const refs: KeyRef[] = []
	for (const m of text.matchAll(call)) {
		const namespace = namespaceAt(bindings, m[1], m.index)
		if (namespace === undefined) continue
		const end = m.index + m[0].length - 1
		refs.push({ key: join(namespace, m[3]), start: end - m[3].length, end })
	}
	return refs
}

// `linePrefix` is the line up to the cursor; returns the namespace and the part of the key typed so far.
export function keyBeingTyped(text: string, offset: number, linePrefix: string) {
	const m = KEY_BEING_TYPED.exec(linePrefix)
	if (!m) return
	const namespace = namespaceAt(findBindings(text), m[1], offset)
	if (namespace === undefined) return
	return { namespace, typed: m[2] }
}

export function flatten(node: unknown, prefix: string, values: Map<string, string>, groups: Set<string>) {
	if (typeof node !== 'object' || node === null) {
		values.set(prefix, String(node))
		return
	}
	if (prefix) groups.add(prefix)
	for (const [key, child] of Object.entries(node)) flatten(child, join(prefix, key), values, groups)
}

// Languages whose code is not their country's code; the rest share it (pl, de, fr, ...).
const COUNTRY_OF_LANGUAGE: Record<string, string> = {
	ar: 'SA', be: 'BY', bn: 'BD', cs: 'CZ', da: 'DK', el: 'GR', en: 'US', et: 'EE', fa: 'IR', ga: 'IE',
	he: 'IL', hi: 'IN', hy: 'AM', ja: 'JP', ka: 'GE', kk: 'KZ', ko: 'KR', ms: 'MY', nb: 'NO', nn: 'NO',
	sl: 'SI', sq: 'AL', sr: 'RS', sv: 'SE', uk: 'UA', ur: 'PK', vi: 'VN', zh: 'CN',
}

export function flag(locale: string) {
	const [language, region] = locale.split(/[-_]/)
	const country = (region?.length === 2 ? region : COUNTRY_OF_LANGUAGE[language.toLowerCase()] ?? language).toUpperCase()
	if (!/^[A-Z]{2}$/.test(country)) return ''
	return String.fromCodePoint(...[...country].map((letter) => 0x1f1a5 + letter.charCodeAt(0)))
}

// Locale names come from folder and file names, so one that is not a valid language tag shows as is.
export function languageName(locale: string) {
	const tag = locale.replaceAll('_', '-')
	try {
		// `style: 'short'` gives "English (US)" in both V8 and JavaScriptCore; the default differs between their ICU data.
		const names = new Intl.DisplayNames([tag], { type: 'language', languageDisplay: 'standard', style: 'short' })
		const name = names.of(tag) ?? locale
		return name.charAt(0).toLocaleUpperCase(tag) + name.slice(1)
	} catch {
		return locale
	}
}

// Default locale first. `pl` also matches `pl-PL` or `pl_PL` (and the other way round) when no exact name exists.
export function withDefaultFirst(locales: string[], displayLocale: string) {
	const language = (locale: string) => locale.split(/[-_]/)[0].toLowerCase()
	const sorted = [...locales].sort()
	const defaultLocale =
		sorted.find((locale) => locale === displayLocale) ??
		sorted.find((locale) => language(locale) === language(displayLocale))
	if (!defaultLocale) return sorted
	return [defaultLocale, ...sorted.filter((locale) => locale !== defaultLocale)]
}
