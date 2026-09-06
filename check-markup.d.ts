export declare function sharedStyledClasses(): Promise<Set<string>>;
export interface SharedMarkupFinding { file: string; line: number; className: string }
export declare function findSharedMarkup(options: { dir: string; classPrefix: string; allow?: readonly string[] }): Promise<SharedMarkupFinding[]>;
