/**
 * Commercial-Grade Data Flow Analyzer
 *
 * Implements:
 * - Interprocedural data flow analysis (cross-function tracking)
 * - Control flow sensitivity (branches, loops, exceptions)
 * - Path sensitivity (different branches = different type states)
 * - Context sensitivity (same function, different call sites = different types)
 * - Worklist algorithm with fixed-point computation
 * - Lattice-based abstract interpretation
 * - Symbolic execution for branch conditions
 * - Points-to analysis for reference tracking
 * - Taint analysis for security-sensitive data
 * - Escape analysis for closure/global escape
 */
/**
 * Abstract value in the data flow lattice
 */
export interface AbstractValue {
    /** Type representation */
    type: string;
    /** Possible values (constants) */
    constants: Set<string>;
    /** Is null/undefined possible */
    nullable: boolean;
    /** Property types if object */
    properties: Map<string, AbstractValue>;
    /** Array element type if array */
    elementType?: AbstractValue;
    /** Is this value tainted (user input, etc.) */
    tainted: boolean;
    /** Where did this value escape (closure, global, return) */
    escapes: Set<'closure' | 'global' | 'parameter' | 'return'>;
}
/**
 * Data flow fact at a program point
 */
export interface DataFlowFact {
    /** Variable name -> abstract value */
    env: Map<string, AbstractValue>;
    /** Type constraints */
    constraints: TypeConstraint[];
    /** Path condition (branch predicates) */
    pathCondition: PathCondition[];
}
/**
 * Type constraint
 */
export interface TypeConstraint {
    variable: string;
    predicate: string;
    thenTypes?: Map<string, AbstractValue>;
    elseTypes?: Map<string, AbstractValue>;
}
/**
 * Path condition from branch predicates
 */
export interface PathCondition {
    expression: string;
    /** true = then branch, false = else branch */
    polarity: boolean;
}
/**
 * Analysis result with full flow paths
 */
export interface DataFlowResult {
    hasDataLeaks: boolean;
    flowPaths: FlowPath[];
    taintedPaths: TaintedPath[];
    typeNarrowing: Map<string, {
        line: number;
        types: string[];
    }[]>;
    statistics: {
        nodesAnalyzed: number;
        blocksConstructed: number;
        callSitesAnalyzed: number;
        fixedPointIterations: number;
        constraintsGenerated: number;
        typesNarrowed: number;
        promiseUnwraps: number;
        conditionalBranches: number;
        escapedValues: number;
        taintedValues: number;
        pathsTracked: number;
    };
    confidence: 'high' | 'medium' | 'low';
    duration: number;
    /** All facts at exit of each block */
    finalFacts: Map<string, DataFlowFact>;
}
export interface FlowPath {
    source: string;
    sink: string;
    path: string[];
    typeAtSink: string;
    typeAtSource: string;
    isTainted: boolean;
}
export interface TaintedPath {
    source: string;
    sink: string;
    taintSource: 'user-input' | 'file-read' | 'network' | 'environment';
    path: string[];
}
export declare class DataFlowAnalyzer {
    private program;
    private checker;
    private sourceFiles;
    private cfgCache;
    private worklist;
    private analyzedCallSites;
    private maxIterations;
    private maxCallDepth;
    private trackTaint;
    private trackEscapes;
    constructor(projectRoot: string, tsConfigPath: string);
    /**
     * MAIN ENTRY POINT - Full interprocedural data flow analysis
     */
    analyzeDataFlow(functionName: string, functionFile: string): DataFlowResult;
    /**
     * Find function declaration
     */
    private findFunction;
    /**
     * Build Control Flow Graph with basic blocks
     */
    private buildCFG;
    /**
     * Create entry fact with parameter bindings
     */
    private createEntryFact;
    /**
     * Create abstract value from TypeScript type
     */
    private createAbstractValue;
    /**
     * WORKLIST ALGORITHM - Lattice-based fixed-point computation
     *
     * This is the core of the data flow analysis.
     * It iterates until no facts change (fixed point is reached).
     */
    private runWorklistAnalysis;
    /**
     * JOIN operation - combine facts from multiple predecessors
     */
    private joinFacts;
    /**
     * LATTICE MEET - intersection of abstract values
     */
    private latticeMeet;
    /**
     * TRANSFER FUNCTION - apply a statement's effect on facts
     */
    private transfer;
    /**
     * Transfer function for expressions
     */
    private transferExpr;
    /**
     * Evaluate expression to get abstract value
     */
    private evaluateExpr;
    /**
     * Analyze a call site (interprocedural analysis)
     */
    private analyzeCallSite;
    /**
     * Check if expression is a taint source
     */
    private isTaintedSource;
    /**
     * Check if expression causes escape
     */
    private doesEscape;
    /**
     * Analyze async patterns (Promise, await)
     */
    private analyzeAsyncPatterns;
    /**
     * Check for data leaks (tainted -> escape)
     */
    private checkDataLeaks;
    /**
     * Clone a data flow fact
     */
    private cloneFact;
    /**
     * Narrow types based on branch condition
     * E.g., if (x != null) narrows x from T | null to T
     *       if (x > 1000) narrows the possible range of x
     */
    private narrowTypesFromCondition;
    /**
     * Check if two facts are equal
     */
    private factsEqual;
    /**
     * Get line number
     */
    private getLine;
    /**
     * Calculate confidence level
     */
    private calculateConfidence;
    /**
     * Create empty result
     */
    private createEmptyResult;
    /**
     * Format as text
     */
    formatAsText(result: DataFlowResult, functionName: string): string;
}
