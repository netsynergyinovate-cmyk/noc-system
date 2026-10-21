"use client";

import { useState } from "react";
import {
  X,
  ChevronRight,
  ChevronDown,
  Server,
  Layers,
  Users,
  GitBranch,
} from "lucide-react";
import { HierarchyTreeNode } from "@/services/map/types";

interface HierarchyTreePanelProps {
  tree: HierarchyTreeNode[];
  onClose: () => void;
  onSelectNode: (node: HierarchyTreeNode) => void;
}

export function HierarchyTreePanel({
  tree,
  onClose,
  onSelectNode,
}: HierarchyTreePanelProps) {
  return (
    <aside
      aria-label="Panel Pohon Relasi"
      className="fixed inset-x-0 bottom-0 md:bottom-auto md:top-[calc(var(--map-toolbar-bottom,4rem)_+_0.5rem)] md:right-4 md:left-auto z-[1050] md:max-w-[min(28rem,50vw)] w-full bg-card/95 backdrop-blur-md text-card-foreground border border-border shadow-2xl rounded-t-2xl md:rounded-2xl max-h-[60dvh] md:max-h-[calc(100dvh_-_var(--map-toolbar-bottom,4rem)_-_1.5rem)] flex flex-col overflow-hidden animate-in fade-in slide-in-from-right-4 duration-200"
    >
      <div className="flex items-center justify-between p-4 border-b border-border bg-muted/20">
        <div className="flex items-center gap-2">
          <GitBranch className="w-5 h-5 text-primary" />
          <div>
            <h3 className="font-semibold text-sm text-foreground">
              Pohon Relasi Jaringan
            </h3>
            <p className="text-[10px] text-muted-foreground">
              Hierarki Server → ODC → ODP → Pelanggan
            </p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          type="button"
          aria-label="Tutup panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Baris Petunjuk Indikator Konsisten Sesuai PRD */}
      <div className="flex items-center gap-2.5 px-4 py-2 border-b border-border/40 bg-muted/10 text-[10px] text-muted-foreground overflow-x-auto shrink-0 select-none">
        <span className="flex items-center gap-1 font-medium text-foreground">
          <Server className="w-3 h-3 text-indigo-500" /> Server
        </span>
        <span className="text-muted-foreground/40">•</span>
        <span className="flex items-center gap-1 font-medium text-foreground">
          <Layers className="w-3 h-3 text-purple-500" /> ODC
        </span>
        <span className="text-muted-foreground/40">•</span>
        <span className="flex items-center gap-1 font-medium text-foreground">
          <Layers className="w-3 h-3 text-sky-500" /> ODP
        </span>
        <span className="text-muted-foreground/40">•</span>
        <span className="flex items-center gap-1 font-medium text-foreground">
          <Users className="w-3 h-3 text-emerald-500" /> Pelanggan
        </span>
      </div>

      <div className="p-4 overflow-y-auto space-y-2 text-xs flex-1">
        {tree.length === 0 ? (
          <p className="text-muted-foreground italic py-4 text-center">
            Belum ada data relasi perangkat jaringan.
          </p>
        ) : (
          <div className="space-y-1">
            {tree.map((node) => (
              <TreeNodeItem
                key={node.id}
                node={node}
                level={0}
                onSelectNode={onSelectNode}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function TreeNodeItem({
  node,
  level,
  onSelectNode,
}: {
  node: HierarchyTreeNode;
  level: number;
  onSelectNode: (node: HierarchyTreeNode) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children && node.children.length > 0;

  // Konsistensi Warna Ikon Sesuai PRD:
  // Server: text-indigo-500
  // ODC: text-purple-500
  // ODP: text-sky-500 (BUKAN kuning/amber!)
  // Pelanggan: text-emerald-500 (terhubung) / text-amber-500 (isolir) / text-rose-500 (loss)
  const getNodeIcon = (type: string, status?: string) => {
    switch (type) {
      case "server":
        return <Server className="w-3.5 h-3.5 text-indigo-500 shrink-0" />;
      case "odc":
        return <Layers className="w-3.5 h-3.5 text-purple-500 shrink-0" />;
      case "odp":
        return <Layers className="w-3.5 h-3.5 text-sky-500 shrink-0" />;
      case "customer": {
        const s = status?.toLowerCase();
        if (s === "isolir" || s === "menunggak") {
          return <Users className="w-3.5 h-3.5 text-amber-500 shrink-0" />;
        }
        if (s === "loss" || s === "gangguan") {
          return <Users className="w-3.5 h-3.5 text-rose-500 shrink-0" />;
        }
        if (s === "terhubung" || s === "aktif" || s === "normal") {
          return <Users className="w-3.5 h-3.5 text-emerald-500 shrink-0" />;
        }
        return <Users className="w-3.5 h-3.5 text-zinc-400 shrink-0" />;
      }
      default:
        return <GitBranch className="w-3.5 h-3.5 text-zinc-400 shrink-0" />;
    }
  };

  // Label Badge Konsisten
  const getNodeBadge = (type: string, status?: string) => {
    switch (type) {
      case "server":
        return (
          <span className="text-[9px] font-mono uppercase px-1.5 py-0.2 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 font-medium shrink-0">
            Server
          </span>
        );
      case "odc":
        return (
          <span className="text-[9px] font-mono uppercase px-1.5 py-0.2 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 font-medium shrink-0">
            ODC
          </span>
        );
      case "odp":
        return (
          <span className="text-[9px] font-mono uppercase px-1.5 py-0.2 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20 font-medium shrink-0">
            ODP
          </span>
        );
      case "customer": {
        const s = status?.toLowerCase();
        if (s === "isolir" || s === "menunggak") {
          return (
            <span className="text-[9px] font-mono uppercase px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 font-medium shrink-0">
              Isolir
            </span>
          );
        }
        if (s === "loss" || s === "gangguan") {
          return (
            <span className="text-[9px] font-mono uppercase px-1.5 py-0.2 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 font-medium shrink-0">
              Loss
            </span>
          );
        }
        if (s === "terhubung" || s === "aktif" || s === "normal") {
          return (
            <span className="text-[9px] font-mono uppercase px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-medium shrink-0">
              Terhubung
            </span>
          );
        }
        return (
          <span className="text-[9px] font-mono uppercase px-1.5 py-0.2 rounded bg-muted text-muted-foreground border border-border font-medium shrink-0">
            Pelanggan
          </span>
        );
      }
      default:
        return (
          <span className="text-[9px] font-mono uppercase px-1.5 py-0.2 rounded bg-muted text-muted-foreground border border-border font-medium shrink-0">
            {type}
          </span>
        );
    }
  };

  return (
    <div className="select-none">
      <div
        className="flex items-center gap-1.5 py-1 px-2 rounded-lg hover:bg-muted/60 transition-colors group cursor-pointer"
        style={{ paddingLeft: `${Math.max(level * 16, 8)}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="p-0.5 rounded hover:bg-muted text-muted-foreground shrink-0"
            aria-label={expanded ? "Ciutkan cabang" : "Bentangkan cabang"}
          >
            {expanded ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </button>
        ) : (
          <span className="w-4.5 shrink-0" />
        )}

        <div
          onClick={() => onSelectNode(node)}
          className="flex items-center gap-2 flex-1 min-w-0"
        >
          {getNodeIcon(node.type, node.status)}
          <span className="font-medium text-foreground truncate text-xs flex-1 min-w-0">
            {node.name}
          </span>
          {getNodeBadge(node.type, node.status)}
        </div>
      </div>

      {hasChildren && expanded && (
        <div className="border-l border-border/40 ml-4">
          {node.children.map((child) => (
            <TreeNodeItem
              key={child.id}
              node={child}
              level={level + 1}
              onSelectNode={onSelectNode}
            />
          ))}
        </div>
      )}
    </div>
  );
}
