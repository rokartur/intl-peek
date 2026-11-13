import { expect, test } from 'bun:test'
import { findKeyRefs, flag, flatten, keyBeingTyped, languageName, withDefaultFirst } from './parse'

test('default locale goes first, matched by name, then by language', () => {
	expect(withDefaultFirst(['pl', 'en', 'de'], 'pl')).toEqual(['pl', 'de', 'en'])
	expect(withDefaultFirst(['pl-PL', 'en-US'], 'pl')).toEqual(['pl-PL', 'en-US'])
	expect(withDefaultFirst(['pl_PL', 'en_US'], 'pl')).toEqual(['pl_PL', 'en_US'])
	expect(withDefaultFirst(['pl', 'en'], 'pl-PL')).toEqual(['pl', 'en'])
	expect(withDefaultFirst(['pt-PT', 'pt-BR', 'en'], 'pt-BR')).toEqual(['pt-BR', 'en', 'pt-PT'])
	expect(withDefaultFirst(['en', 'de'], 'pl')).toEqual(['de', 'en'])
})

test('language name is written in the language itself, with the variant in parentheses', () => {
	expect(['pl', 'en', 'en-US', 'pl_PL', 'pt-BR', 'not a tag'].map(languageName)).toEqual([
		'Polski',
		'English',
		'English (US)',
		'Polski (Polska)',
		'Português (Brasil)',
		'not a tag',
	])
})

test('flag comes from the region, then the language', () => {
	expect(['pl', 'en', 'pt-BR', 'zh_TW', 'uk', 'de-AT', 'fil'].map(flag)).toEqual(['🇵🇱', '🇺🇸', '🇧🇷', '🇹🇼', '🇺🇦', '🇦🇹', ''])
})

const keys = (text: string) => findKeyRefs(text).map((r) => r.key)

test('aliases resolve to their own namespace', () => {
	const text = `
const t = useTranslations('auth')
const tc = useTranslations('common')
const td = useTranslate()
t('services.title'); tc('table.actions'); td('sms.form.max_chars', { max: 1 })
t.rich('a.b', {}); t.has("c"); obj.t('skip'); format('skip'); t(\`tpl.\${x}\`)`
	expect(keys(text)).toEqual([
		'auth.services.title',
		'common.table.actions',
		'sms.form.max_chars',
		'auth.a.b',
		'auth.c',
	])
})

test('nearest binding above wins and calls before any binding are skipped', () => {
	const text = `t('none')
function A() { const t = useTranslations('a'); t('x') }
function B() { const t = await getTranslations({ locale, namespace: 'b.sub' }); t('y') }
const t3 = useTranslations(); t3('root.key')`
	expect(keys(text)).toEqual(['a.x', 'b.sub.y', 'root.key'])
})

test('ref offsets cover the key inside the quotes', () => {
	const text = `const t = useTranslations('ns'); t('hello')`
	const [ref] = findKeyRefs(text)
	expect(text.slice(ref.start, ref.end)).toBe('hello')
})

test('keyBeingTyped reads the open call at the cursor', () => {
	const text = `const t = useTranslations('auth')\nt('login.`
	expect(keyBeingTyped(text, text.length, "t('login.")).toEqual({ namespace: 'auth', typed: 'login.' })
	expect(keyBeingTyped(text, text.length, 'foo(')).toBeUndefined()
	expect(keyBeingTyped(text, text.length, "x('a")).toBeUndefined()
})

test('flatten records leaves and their parent groups', () => {
	const values = new Map<string, string>()
	const groups = new Set<string>()
	flatten({ a: { b: 'B', c: ['x'] } }, 'ns', values, groups)
	expect([...values]).toEqual([
		['ns.a.b', 'B'],
		['ns.a.c.0', 'x'],
	])
	expect([...groups]).toEqual(['ns', 'ns.a', 'ns.a.c'])
})
