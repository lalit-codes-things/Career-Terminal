import { randomUUID } from 'crypto';
import type {
  ContextItem,
  ContextOrchestrationRequest,
  ContextSourceType,
  OrchestratedContext,
} from '../../../domain/recruiter-intelligence/context-orchestration/contracts';

/**
 * ContextOrchestratorService —  implementation.
 *
 * Automatically assembles, deduplicates, and optimizes context from diverse sources
 * (timeline, memory, facts, etc.) to fit within LLM token limits while maximizing relevance.
 */
export class ContextOrchestratorService {
  constructor(
    // In a real system, this would take dependencies like TokenizerService
  ) {}

  /**
   * Orchestrates an array of raw context items into a finalized, token-optimized context.
   */
  async orchestrate(
    request: ContextOrchestrationRequest,
    rawItems: ContextItem[],
  ): Promise<OrchestratedContext> {
    // 1. Filter by minimum relevance
    let candidates = rawItems;
    if (request.minRelevanceScore !== undefined) {
      candidates = candidates.filter((item) => item.relevanceScore >= request.minRelevanceScore!);
    }

    // 2. Deduplicate based on content hash/similarity
    candidates = this.deduplicate(candidates);

    // 3. Rank items
    candidates = this.rankItems(candidates, request.prioritizedSources);

    // 4. Token Optimization & Compression
    const included: ContextItem[] = [];
    const excluded: ContextItem[] = [];
    let currentTokens = 0;
    const maxTokens = request.maxTokens;

    for (const item of candidates) {
      if (currentTokens + item.tokenCount <= maxTokens) {
        included.push(item);
        currentTokens += item.tokenCount;
      } else {
        // Attempt compression (truncate) if it's highly relevant and we have some room
        const remainingSpace = maxTokens - currentTokens;
        if (remainingSpace > 50 && item.relevanceScore > 0.8) {
          // Naive truncation for demo purposes
          const ratio = remainingSpace / item.tokenCount;
          const keepLength = Math.floor(item.content.length * ratio);
          const compressedContent = item.content.substring(0, keepLength) + '...[truncated]';
          const compressedItem: ContextItem = {
            ...item,
            content: compressedContent,
            tokenCount: remainingSpace,
          };
          included.push(compressedItem);
          currentTokens += remainingSpace;
        } else {
          excluded.push(item);
        }
      }
    }

    // 5. Assemble final prompt text
    const assembledText = this.assembleText(included);

    const originalTokens = rawItems.reduce((sum, i) => sum + i.tokenCount, 0);
    const compressionRatio = originalTokens > 0 ? currentTokens / originalTokens : 1.0;

    return {
      orchestrationId: randomUUID(),
      assembledPromptText: assembledText,
      itemsIncluded: included,
      itemsExcluded: excluded,
      totalTokens: currentTokens,
      compressionRatio,
      generatedAt: new Date(),
    };
  }

  private deduplicate(items: ContextItem[]): ContextItem[] {
    const seen = new Set<string>();
    const unique: ContextItem[] = [];
    for (const item of items) {
      // Very naive deduplication by exact content match.
      // A real implementation uses LSH or semantic similarity threshold.
      const hash = item.content.trim().toLowerCase();
      if (!seen.has(hash)) {
        seen.add(hash);
        unique.push(item);
      }
    }
    return unique;
  }

  private rankItems(items: ContextItem[], prioritizedSources?: ContextSourceType[]): ContextItem[] {
    return [...items].sort((a, b) => {
      let scoreA = a.relevanceScore;
      let scoreB = b.relevanceScore;

      // Apply priority boosts
      if (prioritizedSources) {
        if (prioritizedSources.includes(a.sourceType)) scoreA += 0.2;
        if (prioritizedSources.includes(b.sourceType)) scoreB += 0.2;
      }

      // Tie-breaker: recency if timestamps exist
      if (Math.abs(scoreA - scoreB) < 0.05 && a.timestamp && b.timestamp) {
        return b.timestamp.getTime() - a.timestamp.getTime();
      }

      return scoreB - scoreA; // Descending
    });
  }

  private assembleText(items: ContextItem[]): string {
    // Group by source type for cleaner prompt structure
    const grouped = new Map<ContextSourceType, ContextItem[]>();
    for (const item of items) {
      const list = grouped.get(item.sourceType) || [];
      list.push(item);
      grouped.set(item.sourceType, list);
    }

    let text = '';
    for (const [sourceType, sourceItems] of grouped.entries()) {
      text += `\n--- SOURCE: ${sourceType.toUpperCase()} ---\n`;
      for (const item of sourceItems) {
        text += `${item.content}\n`;
      }
    }

    return text.trim();
  }
}
