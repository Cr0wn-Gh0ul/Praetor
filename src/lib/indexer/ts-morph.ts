import { Node, Project, VariableDeclarationKind } from "ts-morph";
import { MAX_CHUNK_CHARACTERS } from "./constants";
import { chunkMarkdown, chunkPlainText, createSourceChunk, shouldIndexFile, type SourceChunk } from "./chunk";

function makeNodeChunk(filePath: string, startLine: number, endLine: number, symbol: string, source: string): SourceChunk {
  const header = `${filePath}:${startLine}-${endLine} ${symbol}\n`;
  const available = Math.max(0, MAX_CHUNK_CHARACTERS - header.length);
  return createSourceChunk(filePath, startLine, endLine, symbol, source.slice(0, available));
}

function lineRange(node: Node): [number, number] {
  return [node.getStartLineNumber(), node.getEndLineNumber()];
}

export function chunkTypeScript(filePath: string, content: string): SourceChunk[] {
  if (!shouldIndexFile(filePath, Buffer.byteLength(content))) return [];
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: true, jsx: 1 },
  });
  const sourceFile = project.createSourceFile(filePath, content, { overwrite: true });
  const chunks: SourceChunk[] = [];

  const addNode = (node: Node, symbol: string) => {
    const [start, end] = lineRange(node);
    chunks.push(makeNodeChunk(filePath, start, end, symbol, node.getText()));
  };

  sourceFile.getFunctions().forEach((node) => addNode(node, node.getName() ?? "function"));
  sourceFile.getClasses().forEach((node) => {
    const name = node.getName() ?? "class";
    if (node.getText().length <= MAX_CHUNK_CHARACTERS - 160) {
      addNode(node, name);
      return;
    }
    node.getMembers().forEach((member) => {
      const memberName = Node.isMethodDeclaration(member) || Node.isGetAccessorDeclaration(member) || Node.isSetAccessorDeclaration(member)
        ? member.getName()
        : Node.isConstructorDeclaration(member) ? "constructor" : member.getKindName();
      addNode(member, `${name}.${memberName}`);
    });
  });
  sourceFile.getInterfaces().forEach((node) => addNode(node, node.getName()));
  sourceFile.getTypeAliases().forEach((node) => addNode(node, node.getName()));
  sourceFile.getEnums().forEach((node) => addNode(node, node.getName()));
  sourceFile.getVariableDeclarations().forEach((node) => {
    const statement = node.getVariableStatement();
    if (statement?.isExported() && statement.getDeclarationKind() === VariableDeclarationKind.Const) {
      addNode(statement, node.getName());
    }
  });

  const imports = sourceFile.getImportDeclarations().map((declaration) => declaration.getModuleSpecifierValue());
  const exports = sourceFile.getExportDeclarations().map((declaration) => declaration.getModuleSpecifierValue() || "local exports");
  const overview = `Imports: ${imports.join(", ") || "none"}\nExports: ${exports.join(", ") || "none"}`;
  chunks.unshift(makeNodeChunk(filePath, 1, Math.max(1, sourceFile.getEndLineNumber()), "file overview", overview));
  return chunks;
}

export function chunkSourceFile(filePath: string, content: string): SourceChunk[] {
  if (!shouldIndexFile(filePath, Buffer.byteLength(content))) return [];
  if (/\.tsx?$|\.jsx?$/i.test(filePath)) return chunkTypeScript(filePath, content);
  if (/\.mdx?$/i.test(filePath)) return chunkMarkdown(filePath, content);
  return chunkPlainText(filePath, content);
}