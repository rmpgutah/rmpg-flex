// Re-declare tiptap extension commands that v3.29.x dropped from ChainedCommands.
// export {} is required to make this file a module (not a global script) so that
// `declare module` below augments '@tiptap/core' rather than replacing it entirely.
export {};

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    bold:          { toggleBold:      ()                                        => ReturnType }
    italic:        { toggleItalic:    ()                                        => ReturnType }
    strike:        { toggleStrike:    ()                                        => ReturnType }
    underline:     { toggleUnderline: ()                                        => ReturnType }
    code:          { toggleCode:      ()                                        => ReturnType }
    codeBlock:     { toggleCodeBlock: ()                                        => ReturnType }
    heading:       {
      toggleHeading: (attributes: { level: 1|2|3|4|5|6 })                      => ReturnType
      setHeading:    (attributes: { level: 1|2|3|4|5|6 })                      => ReturnType
    }
    paragraph:     { setParagraph:    ()                                        => ReturnType }
    blockquote:    { toggleBlockquote:()                                        => ReturnType }
    horizontalRule:{ setHorizontalRule:()                                       => ReturnType }
    bulletList:    { toggleBulletList:()                                        => ReturnType }
    orderedList:   { toggleOrderedList:()                                       => ReturnType }
    link:          {
      setLink:   (attributes: { href: string; target?: string | null })         => ReturnType
      unsetLink: ()                                                             => ReturnType
    }
  }
}
