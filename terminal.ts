
/***** IMPORTS *****/

import { staticText, hideCursor, showCursor, colors, readKeypress } from './deps.ts'
import * as Tree from './tree.ts'

import type { TranscodeOptions } from './app.ts'


/***** CONSTANTS *****/

const box = {
    intersection    : { double : "╬", normal : "┼", dashed : "╎", dotted : "┊", none : " " },
    line: {
        horizontal  : { normal : "─", double : "═", dashed : "╌", dotted : "┈", none : " " },
        vertical    : { normal : "│", double : "║", dashed : "╎", dotted : "┊", none : " " }
    },
    corner: {
        top: {
            left    : { normal : "┌", double : "╔", dashed : "╌", dotted : "┈", none : " " },
            right   : { normal : "┐", double : "╗", dashed : "╌", dotted : "┈", none : " " }
        },
        bottom: {
            left    : { normal : "└", double : "╚", dashed : "╌", dotted : "┈", none : " " },
            right   : { normal : "┘", double : "╝", dashed : "╌", dotted : "┈", none : " " }
        }
    },
    T: {
        upright     : { normal : "┬", double : "╦", dashed : "╌", dotted : "┈", none : " " },
        upsideDown  : { normal : "┴", double : "╩", dashed : "╌", dotted : "┈", none : " " },
        rotatedLeft : { normal : "├", double : "╠", dashed : "╎", dotted : "┊", none : " " },
        rotatedRight: { normal : "┤", double : "╣", dashed : "╎", dotted : "┊", none : " " }
    }
} as const

/***** STYLING *****/

const style = styler()

function styler() {
    type Classes = typeof classes[number]
    type Styler = { (text : string) : string } & { [_ in Classes] : Styler }
    
    const classes = ['bgBlack', 'bgBlue', 'bgBrightBlack', 'bgBrightBlue', 'bgBrightCyan', 'bgBrightGreen', 'bgBrightMagenta', 'bgBrightRed', 'bgBrightWhite', 'bgBrightYellow', 'bgCyan', 'bgGreen', 'bgMagenta', 'bgRed', 'bgWhite', 'bgYellow', 'black', 'blue', 'bold', 'brightBlack', 'brightBlue', 'brightCyan', 'brightGreen', 'brightMagenta', 'brightRed', 'brightWhite', 'brightYellow', 'cyan', 'dim', 'gray', 'green', 'hidden', 'inverse', 'italic', 'magenta', 'red', 'reset', 'strikethrough', 'stripColor', 'underline', 'white', 'yellow'] as const
    const id = (x => x) as Styler
    
    let stylesToApply = new Array<Classes>

    return new Proxy(id, {
        get(_, property : Classes, receiver) {
            if (classes.includes(property)) stylesToApply.push(property)
            return receiver
        },
        apply(_, __, [ text ] : [ string ]) {
            let styledText = text
            stylesToApply.forEach(s => styledText = colors[s](styledText))
            stylesToApply = []
            return styledText
        }
    })
}

function lineBreak() {
    return box.line.horizontal.normal.repeat(Deno.consoleSize().columns - 1)
}


/***** PRINT TO TERMINAL *****/

let previewing: string[] | undefined

function print(lines : string[]) {
    staticText.clear()
    staticText.outputItems(lines)
    if (previewing !== undefined) staticText.set(previewing)
}

function preview(lines : string[]) {
    previewing = lines
    staticText.set(lines)
}

function clear() {
    previewing = undefined
    staticText.clear()
}


/***** TREE VEIW *****/

function renderFsTreeFromPaths(
    paths : readonly string[],
    sep   : string
) {
    const tree = Tree.simplify(Tree.fromPaths(paths, sep), sep)
    let output = ''
    Tree.walk(tree, (key, value, i, parent) => {
        const ancestors = Array.from(Tree.ancestors(tree, value))
        const lastInFolder = i === (Tree.children(parent).length - 1)
        let structure = ''

        if (Tree.isNode(value)) {
            const childLeaves = Tree.children(value).filter(Tree.isLeaf)
            if (childLeaves.length > 10) key += ' (' + childLeaves.length + ')'
        }
        else {
            const siblingLeaves = Tree.children(parent).filter(Tree.isLeaf)
            if (siblingLeaves.length > 10) return
        }

        ancestors.forEach((node, i) => {
            const parent = ancestors[i+1]
            if (parent === undefined) return
            const siblings = Tree.children(parent)
            const parentIsLastInFolder = siblings.indexOf(node) === (siblings.length - 1)
            if (parentIsLastInFolder) structure += '    '
            else                      structure += '│   '
        })
        
        if (parent !== tree) {
            if (lastInFolder) structure += '└───'
            else              structure += '├───'
        }

        output += structure + (Tree.isNode(value) ? style.inverse(' ' + key + ' ') : key) + '\n'
    })
    return output
}


/***** KEYBOARD INTERACTION *****/

async function selectOneOf(
    prompt  : string,
    options : readonly string[],
    preselected = 0
) : Promise<number> {
    let selected = preselected
    hideCursor()
    render()
    await onKeyPress({
        up  : () => render(selected = Math.max(0, selected - 1)),
        down: () => render(selected = Math.min(options.length - 1, selected + 1))
    })
    clear()
    showCursor()
    return selected

    function render(_?: unknown) {
        let output = '\n'
        options.forEach((option, i) => {
            if (selected === i) output += ` ◉ ${style.inverse(option)}\n`
            else                output += style.dim(` ◎ ${option}\n`)
        })
        output += '\n'
        preview([ prompt, output ])
    }
}

async function selectMultipleOf(
    prompt  : string,
    options : readonly string[],
    preselected = new Array<boolean>(options.length).fill(true)
) : Promise<Array<boolean>> {
    const selected = preselected
    let focused = 0

    hideCursor()
    render()
    await onKeyPress({
        up   : () => render(focused = Math.max(0, focused - 1)),
        down : () => render(focused = Math.min(options.length - 1, focused + 1)),
        space: () => render(toggle(selected, focused))
    })
    clear()
    showCursor()
    return selected

    function render(_?: unknown) {
        clear()
        let output = '\n'
        options.forEach((_option, i) => {
            const isFocused = focused === i
            const isSelected = selected[i]

            if (isSelected && isFocused) output += ' ✓ ' + style.inverse(_option)
            else if (isSelected)         output += ' ✓ ' + _option
            else if (isFocused)          output += style.dim(' ✗ ' + style.inverse(_option))
            else                         output += style.dim(' ✗ ' + _option)
            output += '\n'
        })
        output += '\n'
        preview([ prompt, output ])
    }
}


async function selectPaths(
    prompt : string,
    paths  : readonly string[],
    sep    : string,
    preselected = new Array<boolean>(paths.length).fill(true)
) : Promise<Array<boolean>> {
    const tree = Tree.simplify(Tree.fromPaths(paths, sep), sep)
    const selected = preselected
    const openNodes = Tree.nodes(tree)
    let focused : Tree.Node | Tree.Leaf = Tree.children(tree)[0]
    
    hideCursor()
    render()
    await onKeyPress({
        up: () => {
            const parent = Tree.parent(tree, focused)
            if (parent === undefined) return
            
            const siblings = Tree.children(parent)
            const focusedIndex = siblings.indexOf(focused)

            if (focusedIndex === 0) return render(focused = parent)
            else {
                const previousSibling = siblings.at(focusedIndex - 1)
                if (previousSibling !== undefined) return render(focused = previousSibling)
            }
        },
        down: () => {
            if (Tree.isNode(focused) && openNodes.has(focused)) {
                const child = Tree.firstChild(focused)
                if (child !== undefined) return render(focused = child)
            }
            else {
                const next = nextOutwards(focused)
                if (next !== undefined) return render(focused = next)
            }

            function nextOutwards(
                current : typeof focused
            ) : typeof focused | undefined {
                const parent = Tree.parent(tree, current)
                if (parent === undefined) return
                
                const siblings     = Tree.children(parent)
                const focusedIndex = siblings.indexOf(current)
                const nextSibling  = siblings.at(focusedIndex + 1)
                
                if (nextSibling !== undefined) return nextSibling
                else return nextOutwards(parent)
            }
        },
        left: () => {
            if (Tree.isNode(focused) && openNodes.has(focused))
                return render(openNodes.delete(focused))
            
            const parent = Tree.parent(tree, focused)
            if (parent !== undefined) return render(focused = parent)
        },
        right: () => {
            if (Tree.isLeaf(focused)) {
                const parent = Tree.parent(tree, focused)
                if (parent === undefined) return
                const siblings     = Tree.children(parent)
                const focusedIndex = siblings.indexOf(focused)
                const nextSibling  = siblings.at(focusedIndex + 1)
                if (nextSibling !== undefined) return render(focused = nextSibling)
            }
            else if (openNodes.has(focused)) {
                const child = Tree.firstChild(focused)
                if (child !== undefined) return render(focused = child)
            }
            else return render(openNodes.add(focused))
        },
        space: () => {
            if (Tree.isLeaf(focused)) return render(toggle(selected, focused))
            const leaves = Tree.leaves(focused)
            
            if (Array.from(leaves).every(leaf => selected[leaf]))
                return render(leaves.forEach(leaf => selected[leaf] = false))
            else
                return render(leaves.forEach(leaf => selected[leaf] = true))
        }
    })
    clear()
    showCursor()
    return selected

    function render(_?: unknown) {
        clear()
        let output = '\n'
        Tree.walk(tree, (key, value, i, parent) => {
            const ancestors = Array.from(Tree.ancestors(tree, value))
            if (ancestors.some(p => Tree.isNode(p) && openNodes.has(p) === false)) return
            const lastInFolder = i === (Tree.children(parent).length - 1)
            let structure = ''
    
            ancestors.forEach((node, i) => {
                const parent = ancestors[i+1]
                if (parent === undefined) return
                const siblings = Tree.children(parent)
                const parentIsLastInFolder = siblings.indexOf(node) === (siblings.length - 1)
                if (parentIsLastInFolder) structure += '    '
                else                      structure += '│   '
            })
            
            if (parent !== tree) {
                if (lastInFolder) structure += '└─'
                else              structure += '├─'
            }

            const openStatus = Tree.isLeaf(value) ? '──' : openNodes.has(value) ? '▼ ' : '▷ '
            const selectionStatus =
                Tree.isLeaf(value) ? selected[value]                         ? '☑' : '☐' :
                Array.from(Tree.leaves(value)).every(leaf => selected[leaf]) ? '☑' :
                Array.from(Tree.leaves(value)).some(leaf => selected[leaf])  ? '⊟' : '☐'

            const entryStyle =
                Tree.isLeaf(value) && !selected[value]         && focused === value ? style.inverse.strikethrough :
                Tree.isLeaf(value) &&  selected[value]         && focused === value ? style.inverse :
                Tree.isLeaf(value) && !selected[value]         && focused !== value ? style.dim.strikethrough :
                Tree.isLeaf(value)  /* selected[value]         && focused !== valu*/? style :
                Tree.someLeaves(value, leaf => selected[leaf]) && focused === value ? style.inverse :
             /* Tree.everyLeaf (value, leaf not selected) */      focused === value ? style.inverse.strikethrough :
                Tree.everyLeaf (value, leaf => selected[leaf]) && focused !== value ? style.bold.underline :
                Tree.someLeaves(value, leaf => selected[leaf]) && focused !== value ? style.bold.underline.dim :
             /* Tree.everyLeaf (value, leaf not selected)      && focused !== value*/ style.bold.underline.dim.strikethrough
            
            const entryName = entryStyle(key)
            output += structure + openStatus + selectionStatus + ' ' + entryName + '\n'
        })
        output += '\n' 
        preview([ prompt, output ])
    }
}

type Immutable<A> = {
    readonly [Key in keyof A]: Immutable<A[Key]>
}

async function selectEncodingOptions(
    prompt  : string,
    options : Immutable<TranscodeOptions>
) : Promise<TranscodeOptions> {

    const selectedWidths  = options.widths.map(({ enabled }) => enabled)
    const selectedFormats = options.formats.map(({ enabled }) => enabled)
    const qualities       = options.formats.map(({ quality }) => quality)
    
    let focused : 'widths' | 'formats' | 'qualities'
    let focusedWidth   = 0
    let focusedFormat  = 0
    let focusedQuality = 0

    hideCursor()
    render()
    await selectWidths()
    clear()
    showCursor()
    return {
        widths : options.widths.filter((_, i) => selectedWidths[i]),
        formats:
            options.formats
            .filter((_, i) => selectedFormats[i])
            .map(({ ...format }, i) => ({ ...format, quality: qualities[i] }))
    }

    function selectWidths(): Promise<unknown> {
        render(focused = 'widths')
        return onKeyPress({
            left  : () => render(focusedWidth = Math.max(0, focusedWidth - 1)),
            right : () => render(focusedWidth = Math.min(selectedWidths.length - 1, focusedWidth + 1)),
            down  : selectFormats,
            space : () => render(toggle(selectedWidths, focusedWidth)),
            delete: () => render(selectedWidths[focusedWidth] = false),
        })
    }

    function selectFormats(): Promise<unknown> {
        render(focused = 'formats')
        return onKeyPress({
            up    : selectWidths,
            left  : () => render(focusedFormat = Math.max(0, focusedFormat - 1)),
            right : () => render(focusedFormat = Math.min(options.formats.length, focusedFormat + 1)),
            down  : selectQualities,
            space : () => render(toggle(selectedFormats, focusedFormat)),
            delete: () => render(selectedFormats[focusedFormat] = false)
        })
    }

    function selectQualities(): Promise<unknown> {
        render(focused = 'qualities')
        return onKeyPress({
            up: () => {
                if (focusedQuality === 0) return selectFormats()
                else return render(focusedQuality -= 1)
            },
            left: () => {
                const curQuality = qualities[focusedQuality]
                const minQuality = options.formats[focusedQuality].minimum
                const newQuality = Math.max(minQuality, curQuality - 1)
                return render(qualities[focusedQuality] = newQuality)
            },
            right: () => {
                const curQuality = qualities[focusedQuality]
                const maxQuality = options.formats[focusedQuality].maximum
                const newQuality = Math.min(maxQuality, curQuality + 1)
                return render(qualities[focusedQuality] = newQuality)
            },
            down: () => {
                if (focusedQuality === options.formats.length - 1) return
                else return render(focusedQuality += 1)
            },
        })
    }

    function render(_?: unknown) {
        clear()
        let output = '\n'

        const widthsTitle = (focused === 'widths'  ? style.bold.underline : style.bold)('widths')
        const widthsBody = options.widths.map(({ width }, i) => {
            const selected = selectedWidths[i]
            const widthStyle =
                focused === 'widths' && focusedWidth === i && !selected ? style.inverse.strikethrough :
                focused === 'widths' && focusedWidth === i &&  selected ? style.inverse :
                                                              !selected ? style.dim.strikethrough : style
            
            return (selected ? '✓ ' : '✗ ') + widthStyle(String(width).padEnd(4))
        })
        output += widthsTitle + '\n    ' + widthsBody.join('    ') + '\n\n'

        const formatsTitle = (focused === 'formats' ? style.bold.underline : style.bold)('formats')
        const formatsBody = options.formats.map(({ format }, i) => {
            const enabled = selectedFormats[i]
            const formatStyle =
                focused === 'formats' && focusedFormat === i && !enabled ? style.inverse.strikethrough :
                focused === 'formats' && focusedFormat === i &&  enabled ? style.inverse :
                                                                !enabled ? style.dim.strikethrough : style
            
            return (enabled ? '✓ ' : '✗ ') + formatStyle(format)
        })
        output += formatsTitle + '\n    ' + formatsBody.join('    ') + '\n\n'
        
        const qualitiesTitle = (focused === 'qualities' ? style.bold.underline : style.bold)('qualities')
        const qualitiesBody = options.formats.map(({ format }, i) => {
            const selected = selectedFormats[i]
            const quality = qualities[i]
            const focusedOnFormat = focused === 'qualities' && focusedQuality === i
            const qualityTitle = (focusedOnFormat ? style.underline : style)(format)
            const qualityText  = (focusedOnFormat ? style.inverse   : style)(String(quality))

            const qualityControls =
                focusedOnFormat === false
                    ? '   ' + qualityText
                    : (
                        (quality === options.formats[i].minimum ? '◁  ' : '◀  ') +
                        qualityText +
                        (quality === options.formats[i].maximum ? '  ▷' : '  ▶')
                    )
            
            return (selected ? style : style.dim.strikethrough)(qualityTitle + ' ' + qualityControls)
        })
        output += qualitiesTitle + '\n    ' + qualitiesBody.join('\n    ') + '\n\n'

        preview([ prompt, output ])
    }
}

const stop = Symbol()
onKeyPress.stop = stop
async function onKeyPress(
    handlers: Record<string, typeof stop | (() => unknown)>
) {
    handlers.return ??= stop
    for await (const keypress of readKeypress()) {
        if (keypress.ctrlKey && keypress.key === 'c') Deno.exit()
        if (keypress.key === undefined) continue
        const handler = handlers[keypress.key]
        if (handler === undefined)    continue
        if (handler === stop)         return stop
        if (await handler() === stop) return stop
        /* ^ Awaiting here allows a child onKeyPress to            */
        /* exclusively respond to the key presses.                 */
        /*                                                         */
        /* When the child loop exits and returns stop, it will be  */
        /* passed up the chain, and the parents will break their   */
        /* loops as well.                                          */
        /*                                                         */
        /* The alternative would be that the user press enter once */
        /* for each loop they somehow entered.                     */
        /*                                                         */
        /* For this to happen, however, it is important that the   */
        /* key-press callback return the result of the child       */
        /* onKeyProcess; it should not be a void function.         */
    }
    return stop
}


/***** TABLE *****/

interface TableFormatOptions {
    border   : 'normal' | 'double' | 'dashed' | 'dotted' | 'none'
    padding  : number
    maxWidth : number
}

function formatTable(
    data : Array<Array<string>>,
    {
        border   = 'normal',
        padding  = 1,
        maxWidth = Deno.consoleSize().columns
    }: Partial<TableFormatOptions> = {}
) {
    if (data.length > 0 === false) return ''
    
    const columnContentWidths = columnWidths(data)
    const usableColumnWidths = shrinkWidths(columnContentWidths, maxWidth - (2 * padding * columnContentWidths.length) - 1)
    const linedRows =
        data.map(row => {
            const rowLines = row.map((entry, i) => splitAtMaxWidth(entry, usableColumnWidths[i]))
            const rowHeight = padding * 2 + rowLines.reduce((max, lines) => lines.length > max ? lines.length : max, 0)
            const paddedLines =
                rowLines.map((lines, i) => [
                    ...Array.from({ length: Math.floor((rowHeight - lines.length) / 2) }, _ => ' '.repeat(usableColumnWidths[i] + 2 * padding)),
                    ...lines.map(line => ' '.repeat(padding) + line.padEnd(usableColumnWidths[i]) + ' '.repeat(padding)),
                    ...Array.from({ length: Math.ceil((rowHeight - lines.length) / 2) }, _ => ' '.repeat(usableColumnWidths[i] + 2 * padding))
                ])
            return paddedLines
        })
    
    const topBorder =
        box.corner.top.left[border] +
        usableColumnWidths
            .map(width => box.line.horizontal[border].repeat(width + padding * 2))
            .join(box.T.upright[border]) +
        box.corner.top.right[border]

    const rowSeparator =
        box.T.rotatedLeft[border] + 
        usableColumnWidths
            .map(width => box.line.horizontal[border].repeat(width + padding * 2))
            .join(box.intersection[border]) +
        box.T.rotatedRight[border]

    const bottomBorder =
        box.corner.bottom.left[border] +
        usableColumnWidths
            .map(width => box.line.horizontal[border].repeat(width + padding * 2))
            .join(box.T.upsideDown[border]) +
        box.corner.bottom.right[border]
    
    const rows =
        linedRows.map(row => 
            row.reduce((joined, entryLines) =>
                entryLines.map((line, i) =>
                    joined[i] + box.line.vertical[border] + line
                )
            ).map(line => box.line.vertical[border] + line + box.line.vertical[border])
        )

    const middle = rows.map(rowLines => rowLines.join('\n')).join('\n' + rowSeparator + '\n')

    return topBorder + '\n' + middle + '\n' + bottomBorder
}

function shrinkWidths(
    columnWidths: Array<number>,
    availableWidth: number
) : Array<number> {
    const widthToBeUsed = columnWidths.reduce((sum, width) => sum + width, 0)
    if (availableWidth >= (columnWidths.length * 4) && widthToBeUsed > availableWidth) {
        const largestColumnWidth =
            columnWidths.reduce((largest, width) =>
                width > largest
                    ? width
                    : largest,
                0
            )
        
        const newColumnWidths =
            columnWidths.map(width =>
                width === largestColumnWidth
                    ? Math.floor(largestColumnWidth / 2)
                    : width
            )
        
        return shrinkWidths(newColumnWidths, availableWidth)
    }
    return columnWidths
}

function splitAtMaxWidth(
    input : string,
    maxWidth : number,
    chunks = new Array<string>
) : Array<string> {
    if (input.includes('\n')) {
        const [ firstLine, ...rest ] = input.split('\n')
        return splitAtMaxWidth(rest.join('\n'), maxWidth, [ ...chunks, ...splitAtMaxWidth(firstLine, maxWidth) ])
    }
    if (input.length <= maxWidth) return [ ...chunks, input ]
    const chunk = input.slice(0, maxWidth)
    const rest = input.slice(maxWidth)
    return splitAtMaxWidth(rest, maxWidth, [ ...chunks, chunk ])
}

function columnWidths(
    data : Array<Array<string>>,
    widths = data.at(0)?.map(cell => cell.length)
) : Array<number> {
    if (widths === undefined) return []
    const [ first, ...rest ] = data
    if (first === undefined) return widths
    return columnWidths(rest, widths.map((width, i) => first[i].length > width ? first[i].length : width))
}

/***** UTILITY FUNCTIONS *****/

function toggle<Key extends string | number | symbol>(
    obj: { [_ in Key]: boolean },
    key: Key
) {
    obj[key] = !obj[key]
}


/***** EXPORTS *****/

export { style, lineBreak, print, preview, clear, onKeyPress, selectOneOf, selectMultipleOf, selectPaths, selectEncodingOptions, /* formatTable, */ renderFsTreeFromPaths }
