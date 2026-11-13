import * as vscode from 'vscode'
import { findKeyRefs, flag, flatten, jsonEntry, keyBeingTyped, languageName, withDefaultFirst, type KeyRef } from './parse'

const LANGUAGES = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact']
const AUTODETECT_GLOB = '**/{locales,messages}/**/*.json'

type LocaleFile = { uri: vscode.Uri; locale: string; prefix: string; values: Map<string, string>; groups: Set<string> }

const files = new Map<string, LocaleFile>()
let locales: string[] = []

const diagnostics = vscode.languages.createDiagnosticCollection('intl-peek')
// VS Code has no API to replace text, so CSS smuggled through textDecoration hides the key and `before` shows the value.
const inlineValue = vscode.window.createTextEditorDecorationType({
	textDecoration: 'none; display: none;',
	before: { color: new vscode.ThemeColor('editorCodeLens.foreground'), fontStyle: 'italic' },
})

export function activate(context: vscode.ExtensionContext) {
	let watcher = watchLocaleFiles()
	void loadAllLocaleFiles()

	context.subscriptions.push(
		diagnostics,
		inlineValue,
		progressChanged,
		vscode.window.registerTreeDataProvider('intl-peek.progress', progressTree),
		vscode.commands.registerCommand('intl-peek.openKey', openKey),
		vscode.commands.registerCommand('intl-peek.addTranslation', addTranslation),
		{ dispose: () => watcher.dispose() },
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (!event.affectsConfiguration('intl-peek')) return
			watcher.dispose()
			watcher = watchLocaleFiles()
			void loadAllLocaleFiles()
		}),
		vscode.window.onDidChangeVisibleTextEditors(refreshAll),
		vscode.window.onDidChangeTextEditorSelection((event) => decorate(event.textEditor)),
		vscode.workspace.onDidChangeTextDocument((event) => refreshDocument(event.document)),
		vscode.workspace.onDidOpenTextDocument(refreshDocument),
		vscode.workspace.onDidCloseTextDocument((document) => diagnostics.delete(document.uri)),
		vscode.languages.registerHoverProvider(LANGUAGES, { provideHover }),
		vscode.languages.registerDefinitionProvider(LANGUAGES, { provideDefinition }),
		vscode.languages.registerCompletionItemProvider(LANGUAGES, { provideCompletionItems }, "'", '"', '`', '.'),
	)
}

function settings() {
	const config = vscode.workspace.getConfiguration('intl-peek')
	return { localesPath: config.get<string>('localesPath', ''), displayLocale: config.get<string>('displayLocale', 'pl') }
}

function localesGlob() {
	const { localesPath } = settings()
	return localesPath ? `${localesPath.replace(/\/+$/, '')}/**/*.json` : AUTODETECT_GLOB
}

function watchLocaleFiles() {
	const watcher = vscode.workspace.createFileSystemWatcher(localesGlob())
	const reload = async (uri: vscode.Uri) => {
		await loadLocaleFile(uri)
		indexLocales()
	}
	watcher.onDidCreate(reload)
	watcher.onDidChange(reload)
	watcher.onDidDelete((uri) => {
		files.delete(uri.toString())
		indexLocales()
	})
	return watcher
}

async function loadAllLocaleFiles() {
	files.clear()
	const uris = await vscode.workspace.findFiles(localesGlob(), '**/node_modules/**')
	await Promise.all(uris.map(loadLocaleFile))
	indexLocales()
}

// `<root>/<locale>.json` holds every namespace, `<root>/<locale>/<namespace>.json` holds one.
function placeInLayout(uri: vscode.Uri) {
	const { localesPath } = settings()
	const parts = vscode.workspace.asRelativePath(uri, false).split('/')
	const rootDepth = localesPath
		? localesPath.split('/').filter(Boolean).length
		: parts.findIndex((part) => part === 'locales' || part === 'messages') + 1
	const below = parts.slice(rootDepth)
	const name = below.at(-1)!.replace(/\.json$/, '')
	if (below.length === 1) return { locale: name, prefix: '' }
	if (below.length === 2) return { locale: below[0], prefix: name }
}

async function loadLocaleFile(uri: vscode.Uri) {
	const place = placeInLayout(uri)
	if (!place) return
	let messages: unknown
	try {
		messages = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)))
	} catch {
		// A half-typed JSON file keeps its last good keys, so diagnostics do not flash "missing" on every keystroke.
		return
	}
	const values = new Map<string, string>()
	const groups = new Set<string>()
	flatten(messages, place.prefix, values, groups)
	files.set(uri.toString(), { uri, ...place, values, groups })
}

function indexLocales() {
	const found = new Set([...files.values()].map((file) => file.locale))
	locales = withDefaultFirst([...found], settings().displayLocale)
	void vscode.commands.executeCommand('setContext', 'intl-peek.hasLocales', locales.length > 0)
	progressChanged.fire()
	refreshAll()
}

function lookup(locale: string, key: string) {
	for (const file of files.values()) {
		if (file.locale !== locale) continue
		const value = file.values.get(key)
		if (value !== undefined) return { file, value }
		if (file.groups.has(key)) return { file, value: undefined }
	}
}

function refreshAll() {
	for (const document of vscode.workspace.textDocuments) refreshDocument(document)
}

function refreshDocument(document: vscode.TextDocument) {
	if (!LANGUAGES.includes(document.languageId)) return
	const refs = locales.length ? findKeyRefs(document.getText()) : []
	const found: vscode.Diagnostic[] = []

	for (const ref of refs) {
		const missing = locales.filter((locale) => !lookup(locale, ref.key))
		if (!missing.length) continue
		const range = new vscode.Range(document.positionAt(ref.start), document.positionAt(ref.end))
		const diagnostic = new vscode.Diagnostic(range, `Missing in ${missing.join(', ')}: ${ref.key}`, vscode.DiagnosticSeverity.Warning)
		diagnostic.source = 'intl-peek'
		found.push(diagnostic)
	}

	diagnostics.set(document.uri, found)
	for (const editor of vscode.window.visibleTextEditors) {
		if (editor.document === document) decorate(editor, refs)
	}
}

// Keys on a line with a cursor or selection stay visible, so they can be edited.
function decorate(editor: vscode.TextEditor, refs?: KeyRef[]) {
	const { document, selections } = editor
	if (!LANGUAGES.includes(document.languageId)) return
	refs ??= findKeyRefs(document.getText())
	const inline: vscode.DecorationOptions[] = []
	for (const ref of refs) {
		const value = lookup(locales[0], ref.key)?.value
		if (!value) continue
		const range = new vscode.Range(document.positionAt(ref.start), document.positionAt(ref.end))
		if (selections.some((s) => s.start.line <= range.start.line && range.end.line <= s.end.line)) continue
		inline.push({ range, renderOptions: { before: { contentText: shorten(value) } } })
	}
	editor.setDecorations(inlineValue, inline)
}

function shorten(value: string) {
	const line = value.replace(/\s+/g, ' ')
	return line.length > 40 ? `${line.slice(0, 39)}…` : line
}

function refAt(document: vscode.TextDocument, position: vscode.Position) {
	const offset = document.offsetAt(position)
	return findKeyRefs(document.getText()).find((ref) => ref.start <= offset && offset <= ref.end)
}

function provideHover(document: vscode.TextDocument, position: vscode.Position) {
	const ref = refAt(document, position)
	if (!ref || !locales.length) return
	const markdown = new vscode.MarkdownString()
	for (const locale of locales) {
		const found = lookup(locale, ref.key)
		markdown.appendMarkdown(`${flag(locale)} **${languageName(locale)}** `)
		if (!found) markdown.appendMarkdown('_missing_')
		else if (found.value === undefined) markdown.appendMarkdown('_group_')
		else markdown.appendText(found.value)
		markdown.appendMarkdown('  \n')
	}
	const range = new vscode.Range(document.positionAt(ref.start), document.positionAt(ref.end))
	return new vscode.Hover(markdown, range)
}

function provideDefinition(document: vscode.TextDocument, position: vscode.Position) {
	const ref = refAt(document, position)
	if (ref) return keyLocation(ref.key)
}

async function keyLocation(key: string, locale = locales.find((l) => lookup(l, key))) {
	const file = locale && localeFile(key, locale)
	if (!file) return
	// A key missing from the file resolves to its deepest existing parent, where it would be added.
	const { symbol } = await walkSymbols(file, key)
	return new vscode.Location(file.uri, symbol?.selectionRange ?? new vscode.Position(0, 0))
}

function localeFile(key: string, locale: string) {
	return [...files.values()].find((f) => f.locale === locale && (!f.prefix || key.startsWith(`${f.prefix}.`)))
}

// Follows `key` down the file's JSON symbols as far as it exists.
async function walkSymbols(file: LocaleFile, key: string) {
	const path = (file.prefix ? key.slice(file.prefix.length + 1) : key).split('.')
	let children =
		(await vscode.commands.executeCommand<vscode.DocumentSymbol[] | undefined>(
			'vscode.executeDocumentSymbolProvider',
			file.uri,
		)) ?? []
	let symbol: vscode.DocumentSymbol | undefined
	let depth = 0
	for (const name of path) {
		const next = children.find((s) => s.name === name)
		if (!next) break
		symbol = next
		children = next.children
		depth++
	}
	return { path, symbol, children, depth }
}

// Writes the default locale's value into `locale`'s file and selects it for overtyping; the user saves.
async function addTranslation({ key, locale }: { key: string; locale: string }) {
	const file = localeFile(key, locale)
	if (!file) return void vscode.window.showWarningMessage(`intl-peek: no ${locale} message file for ${key}`)
	const document = await vscode.workspace.openTextDocument(file.uri)
	const found = await walkSymbols(file, key)
	if (found.depth < found.path.length && found.symbol && found.symbol.kind !== vscode.SymbolKind.Module) {
		return void vscode.window.showWarningMessage(`intl-peek: ${found.symbol.name} in ${locale} is a value, not a group`)
	}
	const value = lookup(locales[0], key)?.value ?? ''
	const { range, text } = translationEdit(document, found, value)
	const edit = new vscode.WorkspaceEdit()
	edit.replace(file.uri, range, text)
	await vscode.workspace.applyEdit(edit)
	const valueStart = document.offsetAt(range.start) + text.lastIndexOf(JSON.stringify(value)) + 1
	const selection = new vscode.Range(
		document.positionAt(valueStart),
		document.positionAt(valueStart + JSON.stringify(value).length - 2),
	)
	await vscode.window.showTextDocument(document, { selection })
}

// Replaces an empty value, appends after the last property of the deepest existing group, or fills an empty group.
function translationEdit(
	document: vscode.TextDocument,
	{ path, symbol, children, depth }: Awaited<ReturnType<typeof walkSymbols>>,
	value: string,
) {
	const unit = /^[ \t]+/m.exec(document.getText())?.[0] ?? '\t'
	if (depth === path.length) return { range: symbol!.range, text: jsonEntry(path.slice(-1), value, unit, depth) }
	const entry = jsonEntry(path.slice(depth), value, unit, depth + 1)
	const last = children.at(-1)
	if (last) return { range: new vscode.Range(last.range.end, last.range.end), text: `,\n${unit.repeat(depth + 1)}${entry}` }
	const brace = symbol ? symbol.range.end.translate(0, -1) : document.positionAt(document.getText().lastIndexOf('}'))
	return { range: new vscode.Range(brace, brace), text: `\n${unit.repeat(depth + 1)}${entry}\n${unit.repeat(depth)}` }
}

async function openKey(key: string, locale?: string) {
	const location = await keyLocation(key, locale)
	if (location) await vscode.window.showTextDocument(location.uri, { selection: location.range })
}

type ProgressNode = { locale: string; key?: string }

const progressChanged = new vscode.EventEmitter<void>()

const progressTree: vscode.TreeDataProvider<ProgressNode> = {
	onDidChangeTreeData: progressChanged.event,
	getChildren(node) {
		if (!node) return locales.map((locale) => ({ locale }))
		return missingKeys(node.locale).map((key) => ({ locale: node.locale, key }))
	},
	getTreeItem({ locale, key }) {
		if (key) {
			const item = new vscode.TreeItem(key)
			const value = lookup(locales[0], key)?.value ?? ''
			item.description = shorten(value)
			item.tooltip = value
			item.contextValue = 'missingKey'
			item.command = { title: 'Open key', command: 'intl-peek.openKey', arguments: [key, locale] }
			return item
		}
		const total = referenceKeys().length
		const item = new vscode.TreeItem(`${flag(locale)} ${languageName(locale)}`)
		item.tooltip = locale
		if (locale === locales[0]) {
			item.description = `${total} keys, default`
			return item
		}
		const missing = missingKeys(locale).length
		const percent = total ? Math.floor(((total - missing) / total) * 100) : 100
		item.description = `${total - missing}/${total} (${percent}%)`
		if (missing) item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed
		return item
	},
}

function referenceKeys() {
	const keys: string[] = []
	for (const file of files.values()) {
		if (file.locale !== locales[0]) continue
		for (const [key, value] of file.values) if (value) keys.push(key)
	}
	return keys
}

// An empty string counts as untranslated.
function missingKeys(locale: string) {
	return referenceKeys().filter((key) => !lookup(locale, key)?.value)
}

function provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
	const linePrefix = document.lineAt(position).text.slice(0, position.character)
	const typing = keyBeingTyped(document.getText(), document.offsetAt(position), linePrefix)
	if (!typing || !locales.length) return
	const prefix = typing.namespace ? `${typing.namespace}.` : ''
	const range = new vscode.Range(position.translate(0, -typing.typed.length), position)
	const items: vscode.CompletionItem[] = []
	for (const file of files.values()) {
		if (file.locale !== locales[0]) continue
		for (const [key, value] of file.values) {
			if (!key.startsWith(prefix)) continue
			const item = new vscode.CompletionItem(key.slice(prefix.length), vscode.CompletionItemKind.Text)
			item.detail = value
			item.range = range
			items.push(item)
		}
	}
	return items
}
