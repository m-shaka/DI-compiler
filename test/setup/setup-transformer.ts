import * as TSModule from "typescript";
import { TS } from "../../src/type/type";
import { di } from "../../src/transformer/di";
import { ensureArray } from "../../src/util/util";
import path from "crosspath";

export interface ITestFile {
  fileName: string;
  text: string;
  entry: boolean;
}

export type TestFile = ITestFile | string;

export interface GenerateTransformerResultOptions {
  typescript: typeof TS;
  cwd: string;
  compilerOptions: Partial<TS.CompilerOptions>;
  stackTraceLength: number;
}

const VIRTUAL_ROOT = "#root";
const VIRTUAL_SRC = "src";
const VIRTUAL_DIST = "dist";

const BASE_FILES = [
  {
    entry: false,
    fileName: "../node_modules/@wessberg/di/package.json",
    text: `
				{
					"name": "@wessberg/di",
					"main": "index.js"
					"types": "index.d.ts",
					"typings": "index.d.ts"
				}
			`,
  },
  {
    entry: false,
    fileName: "../node_modules/@wessberg/di/index.d.ts",
    text: `
				export declare class DIContainer {
				  registerSingleton<T, U extends T = T>(newExpression: unknown, options: unknown): void;
				  registerSingleton<T, U extends T = T>(newExpression: undefined, options: unknown): void;
          registerSingleton<T, U extends T = T>(newExpression?: unknown | undefined, options?: unknown): void;
          registerTransient<T, U extends T = T>(newExpression: unknown, options: unknown): void;
				  registerTransient<T, U extends T = T>(newExpression: undefined, options: unknown): void;
          registerTransient<T, U extends T = T>(newExpression?: unknown | undefined, options?: unknown): void;
          get<T>(options?: unknown): T;
          has<T>(options?: unknown): boolean;
				}
			`,
  },
];

/**
 * Prepares a test
 */
export function generateTransformerResult(
  inputFiles: TestFile[] | TestFile,
  {
    typescript = TSModule,
    cwd = path.join(process.cwd(), VIRTUAL_ROOT),
    compilerOptions: inputCompilerOptions,
    stackTraceLength,
  }: Partial<GenerateTransformerResultOptions> = {}
): { fileName: string; text: string }[] {
  // Optionally set the stack trace length limit
  if (stackTraceLength != null) {
    Error.stackTraceLimit = stackTraceLength;
  }

  const files: ITestFile[] = [...BASE_FILES, ...ensureArray(inputFiles)]
    .map((file) =>
      typeof file === "string"
        ? {
            text: file,
            fileName: `auto-generated-${Math.floor(Math.random() * 100000)}.ts`,
            entry: true,
          }
        : file
    )
    .map((file) => ({
      ...file,
      fileName: path.native.join(cwd, VIRTUAL_SRC, file.fileName),
    }));

  const entryFile = files.find((file) => file.entry);
  if (entryFile == null) {
    throw new ReferenceError(`No entry could be found`);
  }

  const outputFiles: { fileName: string; text: string }[] = [];

  const fileSystem = {
    readFile: (fileName: string): string | undefined => {
      const normalized = path.native.join(fileName);
      const matchedFile = files.find(
        (currentFile) =>
          path.native.normalize(currentFile.fileName) === normalized
      );

      return matchedFile == null ? undefined : matchedFile.text;
    },
    fileExists: (fileName: string): boolean => {
      const normalized = path.native.normalize(fileName);
      return files.some((currentFile) => currentFile.fileName === normalized);
    },

    directoryExists: (dirName: string): boolean => {
      const normalized = path.native.normalize(dirName);
      return (
        files.some(
          (file) =>
            path.native.dirname(file.fileName) === normalized ||
            path.native
              .dirname(file.fileName)
              .startsWith(path.native.normalize(`${normalized}/`))
        ) || typescript.sys.directoryExists(dirName)
      );
    },
  };

  /**
   * Gets a ScriptKind from the given path
   */
  const getScriptKindFromPath = (path: string): TS.ScriptKind => {
    if (path.endsWith(".js")) {
      return typescript.ScriptKind.JS;
    } else if (path.endsWith(".ts")) {
      return typescript.ScriptKind.TS;
    } else if (path.endsWith(".tsx")) {
      return typescript.ScriptKind.TSX;
    } else if (path.endsWith(".jsx")) {
      return typescript.ScriptKind.JSX;
    } else if (path.endsWith(".json")) {
      return typescript.ScriptKind.JSON;
    } else {
      return typescript.ScriptKind.Unknown;
    }
  };

  const compilerOptions: TS.CompilerOptions = {
    module: typescript.ModuleKind.ESNext,
    target: typescript.ScriptTarget.ESNext,
    allowJs: true,
    sourceMap: false,
    outDir: path.join(cwd, VIRTUAL_DIST),
    rootDir: path.normalize(cwd),
    moduleResolution: typescript.ModuleResolutionKind.NodeJs,
    ...inputCompilerOptions,
  };

  const program = typescript.createProgram({
    rootNames: files.map((file) => path.normalize(file.fileName)),
    options: compilerOptions,
    host: {
      ...fileSystem,
      writeFile: () => {
        // This is a noop
      },

      getSourceFile(
        fileName: string,
        languageVersion: TS.ScriptTarget
      ): TS.SourceFile | undefined {
        const normalized = path.normalize(fileName);
        const sourceText = this.readFile(fileName);

        if (sourceText == null) return undefined;

        return typescript.createSourceFile(
          normalized,
          sourceText,
          languageVersion,
          true,
          getScriptKindFromPath(normalized)
        );
      },

      getCurrentDirectory() {
        return path.native.normalize(cwd);
      },

      getDirectories(directoryName: string) {
        return typescript.sys
          .getDirectories(directoryName)
          .map(path.native.normalize);
      },

      getDefaultLibFileName(options: TS.CompilerOptions): string {
        return typescript.getDefaultLibFileName(options);
      },

      getCanonicalFileName(fileName: string): string {
        return this.useCaseSensitiveFileNames()
          ? fileName
          : fileName.toLowerCase();
      },

      getNewLine(): string {
        return typescript.sys.newLine;
      },

      useCaseSensitiveFileNames() {
        return typescript.sys.useCaseSensitiveFileNames;
      },

      realpath(p: string): string {
        return path.native.normalize(p);
      },
    },
  });

  const transformers = di({ typescript, program });

  program.emit(
    undefined,
    (fileName, text) => {
      outputFiles.push({ fileName, text });
    },
    undefined,
    undefined,
    transformers
  );

  return outputFiles;
}
