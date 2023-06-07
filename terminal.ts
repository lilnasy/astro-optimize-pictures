
/***** IMPORTS *****/

import { staticText, hideCursor, showCursor, colors, readKeypress } from './deps.ts'
import * as Tree from './tree.ts'

import type { Configuration } from './app.ts'


/***** CONSTANTS *****/

const box = {
    intersection    : { double : "╬", normal : "┼", dashed : "╎", dotted : "┊", none : "" },
    line: {
        horizontal  : { normal : "─", double : "═", dashed : "╌", dotted : "┈", none : "" },
        vertical    : { normal : "│", double : "║", dashed : "╎", dotted : "┊", none : "" }
    },
    corner: {
        top: {
            left    : { normal : "┌", double : "╔", dashed : "╌", dotted : "┈", none : "" },
            right   : { normal : "┐", double : "╗", dashed : "╌", dotted : "┈", none : "" }
        },
        bottom: {
            left    : { normal : "└", double : "╚", dashed : "╌", dotted : "┈", none : "" },
            right   : { normal : "┘", double : "╝", dashed : "╌", dotted : "┈", none : "" }
        }
    },
    T: {
        upright     : { normal : "┬", double : "╦", dashed : "╌", dotted : "┈", none : "" },
        upsideDown  : { normal : "┴", double : "╩", dashed : "╌", dotted : "┈", none : "" },
        rotatedLeft : { normal : "├", double : "╠", dashed : "╎", dotted : "┊", none : "" },
        rotatedRight: { normal : "┤", double : "╣", dashed : "╎", dotted : "┊", none : "" }
    }
} as const

/***** STYLING *****/

const style = styler()

function styler() {
    
    type Style = typeof styles[number]
    
    type Classes =
        | Style[]
        | { [_ in Style] ?: boolean }
    
    type Styler = {
        (text : string, classes ?: Classes) : string
    } & {
        [_ in Style] : Styler
    }
    
    const styles = ['bgBlack', 'bgBlue', 'bgBrightBlack', 'bgBrightBlue', 'bgBrightCyan', 'bgBrightGreen', 'bgBrightMagenta', 'bgBrightRed', 'bgBrightWhite', 'bgBrightYellow', 'bgCyan', 'bgGreen', 'bgMagenta', 'bgRed', 'bgWhite', 'bgYellow', 'black', 'blue', 'bold', 'brightBlack', 'brightBlue', 'brightCyan', 'brightGreen', 'brightMagenta', 'brightRed', 'brightWhite', 'brightYellow', 'cyan', 'dim', 'gray', 'green', 'hidden', 'inverse', 'italic', 'magenta', 'red', 'reset', 'strikethrough', 'stripColor', 'underline', 'white', 'yellow'] as const
    const id = (x => x) as Styler
    
    let stylesToApply = new Array<Style>
    
    return new Proxy(id, {
        get(_, property : Style, receiver) {
            if (styles.includes(property)) stylesToApply.push(property)
            return receiver
        },
        apply(_, __, [ text, classes ] : [ string, Classes | undefined ]) {
            if (Array.isArray(classes))
                classes.forEach(c => {
                    if (styles.includes(c))
                        stylesToApply.push(c)
                })
            
            else if (typeof classes === 'object')
                Object.keys(classes).forEach(key => {
                    if (classes[key as Style] && styles.includes(key as Style))
                        stylesToApply.push(key as Style)
                })
            
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
    Tree.walk(tree, (key, value, parent, depth) => {
        if (depth > 2) return
        const ancestors = Array.from(Tree.ancestors(tree, value))
        const siblings = Tree.children(parent)
        const lastInFolder = value === siblings.at(-1)
        let structure = ''
        
        if (Tree.isNode(value)) {
            key += ' (' + Tree.leaves(value).size + ')'
        }
        else if (siblings.filter(Tree.isLeaf).length > 2) return
        
        ancestors.reverse().forEach((node, i) => {
            const parent = ancestors[i-1]
            if (parent === undefined) return
            const siblings = Tree.children(parent)
            const parentIsLastInFolder = node === siblings.at(-1)
            if (parentIsLastInFolder) structure += '    '
            else                      structure += '│   '
        })
        
        if (parent !== tree) {
            if (lastInFolder) structure += '└───'
            else              structure += '├───'
        }
        
        output += structure + ' ' + key + ' ' + '\n'
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
            if (selected === i) output += ` ◉  ${style.inverse(option)}\n`
            else                output += style.dim(`  ◎ ${option}\n`)
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
    const openNodes = new Set(Tree.children(tree).filter(Tree.isNode))
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
        Tree.walk(tree, (key, value, parent) => {
            const ancestors = Array.from(Tree.ancestors(tree, value))
            if (ancestors.some(p => Tree.isNode(p) && openNodes.has(p) === false)) return
            const siblings = Tree.children(parent)
            const lastInFolder = value === siblings.at(-1)
            let structure = ''
            
            ancestors.reverse().forEach((node, i) => {
                const parent = ancestors[i - 1]
                if (parent === undefined) return
                const siblings = Tree.children(parent)
                const parentIsLastInFolder = node === siblings.at(-1)
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
            
            const isSelected = Tree.isLeaf(value) ? selected[value] : Array.from(Tree.leaves(value)).every(leaf => selected[leaf])
            
            const classes = {
                dim          : !isSelected && focused !== value,
                inverse      : focused === value,
                strikethrough: !isSelected,
            }
            
            const entryName = style(key, classes)
            output += structure + openStatus + selectionStatus + ' ' + entryName + '\n'
        })
        output += '\n' 
        preview([ prompt, output ])
    }
}

async function selectOptions(
    prompt  : string,
    options : Configuration
) : Promise<Configuration> {
    
    let focusedSection : 'placement' | 'widths' | 'formats' | 'qualities'
    let focusedWidth   = 0
    let focusedFormat  : keyof typeof options.formats = 'avif'
    let focusedQuality : keyof typeof options.formats = 'avif'
    
    hideCursor()
    render()
    await selectWidths()
    clear()
    showCursor()
    return options
    
    function selectPlacement(): Promise<unknown> {
        render(focusedSection = 'placement')
        return onKeyPress({
            left : () => render(options.placement.selected = options.placement.options[0]),
            right: () => render(options.placement.selected = options.placement.options[1]),
            down : selectWidths
        })
    }
    
    function selectWidths(): Promise<unknown> {
        render(focusedSection = 'widths')
        return onKeyPress({
            up    : selectPlacement,
            left  : () => render(focusedWidth = Math.max(0, focusedWidth - 1)),
            right : () => render(focusedWidth = Math.min(options.widths.length - 1, focusedWidth + 1)),
            down  : selectFormats,
            space : () => render(toggle(options.widths[focusedWidth], 'enabled')),
            delete: () => render(options.widths[focusedWidth].enabled = false),
        })
    }
    
    function selectFormats(): Promise<unknown> {
        render(focusedSection = 'formats')
        return onKeyPress({
            up    : selectWidths,
            left  : () => render(focusedFormat = focusedFormat === 'jpeg' ? 'webp' : 'avif'),
            right : () => render(focusedFormat = focusedFormat === 'avif' ? 'webp' : 'jpeg'),
            down  : selectQualities,
            space : () => render(toggle(options.formats[focusedFormat], 'enabled')),
            delete: () => render(options.formats[focusedFormat].enabled = false)
        })
    }
    
    function selectQualities(): Promise<unknown> {
        render(focusedSection = 'qualities')
        return onKeyPress({
            up: () => {
                if (focusedQuality === 'avif') return selectFormats()
                else return render(focusedQuality = focusedQuality === 'jpeg' ? 'webp' : 'avif')
            },
            left: () => {
                const { quality, minimum } = options.formats[focusedQuality]
                const newQuality = Math.max(minimum, quality - 1)
                return render(options.formats[focusedQuality].quality = newQuality)
            },
            right: () => {
                const { quality, maximum } = options.formats[focusedQuality]
                const newQuality = Math.min(maximum, quality + 1)
                return render(options.formats[focusedQuality].quality = newQuality)
            },
            down: () => {
                if (focusedQuality === 'jpeg') return
                else return render(focusedQuality = focusedQuality === 'avif' ? 'webp' : 'jpeg')
            },
        })
    }
    
    function render(_?: unknown) {
        clear()
        let output = '\n'
        
        const placementTitle = (focusedSection === 'placement' ? style.bold.underline : style.bold)('placement')
        const placementBody = options.placement.options.map(placementOption => {
            const selected = placementOption === options.placement.selected
            const classes = {
                dim          : !selected && focusedSection !== 'placement',
                strikethrough: !selected,
                inverse      : selected && focusedSection === 'placement'
            }
            return (selected ? '✓ ' : '✗ ') + style(placementOption, classes)
        })
        output += placementTitle + '\n    ' + placementBody.join('    ') + '\n\n'
        
        const widthsTitle = (focusedSection === 'widths'  ? style.bold.underline : style.bold)('widths')
        const widthsBody = options.widths.map(({ width , enabled }, i) => {
            const classes = {
                dim          : !enabled && (focusedSection !== 'widths' || focusedWidth !== i),
                strikethrough: !enabled,
                inverse      : focusedSection === 'widths' && focusedWidth === i
            }
            return (enabled ? '✓ ' : '✗ ') + style(String(width).padEnd(4), classes)
        })
        output += widthsTitle + '\n    ' + widthsBody.join('    ') + '\n\n'
        
        const formatsTitle = (focusedSection === 'formats' ? style.bold.underline : style.bold)('formats')
        const formatsBody  = Object.keys(options.formats).map(format_ => {
            const format  = format_ as keyof typeof options.formats
            const enabled = options.formats[format].enabled
            const classes = {
                inverse      : focusedSection === 'formats' && focusedFormat === format,
                strikethrough: !enabled,
                dim          : !enabled && (focusedSection !== 'formats' || focusedFormat !== format)
            }
            return (enabled ? '✓ ' : '✗ ') + style(format, classes)
        })
        output += formatsTitle + '\n    ' + formatsBody.join('    ') + '\n\n'
        
        const qualitiesTitle = (focusedSection === 'qualities' ? style.bold.underline : style.bold)('qualities')
        const qualitiesBody  = Object.keys(options.formats).map(format_ => {
            const format = format_ as keyof typeof options.formats
            const { enabled, quality, minimum, maximum } = options.formats[format]
            const focusedOnFormat = focusedSection === 'qualities' && focusedQuality === format
            const qualityTitle = (focusedOnFormat ? style.underline : style)(format)
            const qualityText  = (focusedOnFormat ? style.inverse   : style)(String(quality))
            
            const qualityControls =
                focusedOnFormat === false
                    ? '   ' + qualityText
                    : (
                        (quality === minimum ? '◁  ' : '◀  ') +
                        qualityText +
                        (quality === maximum ? '  ▷' : '  ▶')
                    )
            
            const classes = {
                dim          : !enabled && (focusedSection !== 'qualities' || focusedQuality !== format),
                strikethrough: !enabled
            }
            
            return style(qualityTitle + ' ' + qualityControls, classes)
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
        /* The alternative would be that the user press enter      */
        /* several times to exit.                                  */
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

function renderTable(
    data : Array<Array<string>>,
    {
        border   = 'normal',
        padding  = 1,
        maxWidth = Deno.consoleSize().columns - 2
    }: Partial<TableFormatOptions> = {}
) {
    if (data.length > 0 === false) return ''
    
    const columnContentWidths = columnWidths(data)
    const usableColumnWidths = shrinkWidths(columnContentWidths, maxWidth - (2 * padding * columnContentWidths.length) - columnContentWidths.length - 1)
    const linedRows =
        data.map(row => {
            const rowLines = row.map((entry, i) => splitAtMaxWidth(entry, usableColumnWidths[i]))
            const rowHeight = padding * 2 + rowLines.reduce((max, lines) => lines.length > max ? lines.length : max, 0)
            const paddedLines =
                rowLines.map((lines, i) => {
                    const balancingWhitespaceTop    = Array.from({ length: Math.floor((rowHeight - lines.length) / 2) }, _ => ' '.repeat(usableColumnWidths[i] + 2 * padding))
                    const balancingWhitespaceBottom = Array.from({ length: Math.ceil( (rowHeight - lines.length) / 2) }, _ => ' '.repeat(usableColumnWidths[i] + 2 * padding))
                    const content = lines.map(line => ' '.repeat(padding) + line + ' '.repeat(usableColumnWidths[i] - style.stripColor(line).length) + ' '.repeat(padding))
                    return balancingWhitespaceTop.concat(content, balancingWhitespaceBottom)
                })
            return paddedLines
        })
    
    const topBorder =
        box.corner.top.left[border] +
        usableColumnWidths
            .map(width => box.line.horizontal[border].repeat(width + padding * 2))
            .join(box.T.upright[border]) +
        box.corner.top.right[border]
    
    const rowSeparator = iife(_ => {
        if (border === 'none') return '\n'
        
        const leftEdge = box.T.rotatedLeft[border]
        
        const middle = usableColumnWidths
            .map(width => box.line.horizontal[border].repeat(width + padding * 2))
            .join(box.intersection[border]) 
        
        const rightEdge = box.T.rotatedRight[border]
        
        return '\n' + leftEdge + middle + rightEdge + '\n'
    })
    
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
    
    const middle = rows.map(rowLines => rowLines.join('\n')).join(rowSeparator)
    
    return topBorder + '\n' + middle + '\n' + bottomBorder
}

function shrinkWidths(
    columnWidths: Array<number>,
    availableWidth: number
) : Array<number> {
    const widthToBeUsed = columnWidths.reduce((sum, width) => sum + width, 0)
    
    if (availableWidth >= (columnWidths.length * 4) && widthToBeUsed > availableWidth) {
        
        const largestColumnWidth =
            columnWidths.reduce((largest, width) => Math.max(width, largest), 0)
        
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
    
    if (style.stripColor(input).length <= maxWidth)
        return [ ...chunks, input ]
    
    const chunk = input.slice(0, maxWidth)
    const rest = input.slice(maxWidth)
    return splitAtMaxWidth(rest, maxWidth, [ ...chunks, chunk ])
}

function columnWidths(
    data : Array<Array<string>>,
    widths = data.at(0)?.map(_ => 0)
) : Array<number> {
    if (widths === undefined) return []
    const [ currentRow, ...rest ] = data
    if (currentRow === undefined) return widths
    const updatedWidths = widths.map((incumbentLargestWidthInColumn, i) => {
        const cell = currentRow[i]
        const cellWidth = Math.max(...cell.split('\n').map(line => style.stripColor(line).length))
        return Math.max(cellWidth, incumbentLargestWidthInColumn)
    })
    return columnWidths(rest, updatedWidths)
}

/***** UTILITY FUNCTIONS *****/

function toggle<Key extends string | number | symbol>(
    obj: { [_ in Key]: boolean },
    key: Key
) {
    obj[key] = !obj[key]
}

function iife<A>(fun: (...args: unknown[]) => A): A {
    return fun()
}


/***** EXPORTS *****/

export { style, lineBreak, print, preview, clear, onKeyPress, selectOneOf, selectMultipleOf, selectPaths, selectOptions, renderTable, renderFsTreeFromPaths }
