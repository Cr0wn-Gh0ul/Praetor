"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { FolderGit2, GitBranch, Globe, Lock } from "lucide-react";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";

type Repository = { fullName: string; defaultBranch: string; isPrivate: boolean };

async function fetchRepositories(url: string): Promise<Repository[]> {
  const response = await fetch(url, { cache: "no-store" });
  const result = await response.json() as Repository[] | { error?: { message?: string } };
  if (!response.ok) throw new Error("error" in result ? result.error?.message ?? "Could not load repositories." : "Could not load repositories.");
  return result as Repository[];
}

export function RepositorySelector({ selectedRepo, size = "sm" }: { selectedRepo: string; size?: "sm" | "md" }) {
  const { data: repositories, error, isLoading } = useSWR<Repository[]>("/api/repos", fetchRepositories, { revalidateOnFocus: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const options = useMemo<ComboboxOption[]>(() => (repositories ?? []).map((repository) => {
    const [owner = "", name = repository.fullName] = repository.fullName.split("/");
    return {
      value: repository.fullName,
      label: name,
      group: owner,
      icon: repository.isPrivate ? <Lock size={13} /> : <Globe size={13} />,
      meta: <span className="inline-flex items-center gap-1"><GitBranch size={11} />{repository.defaultBranch}</span>,
      keywords: repository.isPrivate ? "private" : "public",
    };
  }), [repositories]);

  async function select(repository: string) {
    if (!repository || repository === selectedRepo) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repository }),
      });
      const result = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Could not select repository.");
      window.location.assign("/dashboard");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not select repository.");
      setBusy(false);
    }
  }

  const [owner, name] = selectedRepo ? selectedRepo.split("/") : ["", ""];

  return (
    <div className="relative min-w-0">
      <Combobox
        label="Active repository"
        value={selectedRepo}
        options={options}
        onChange={(repository) => void select(repository)}
        size={size}
        loading={busy || isLoading}
        disabled={busy}
        error={error ? error.message : undefined}
        placeholder="Choose a repository"
        searchPlaceholder="Search repositories you can write to…"
        emptyText="No writable repositories match."
        icon={<FolderGit2 size={size === "sm" ? 14 : 16} className="shrink-0 text-[var(--accent)]" />}
        panelClassName="w-[min(24rem,calc(100vw-2rem))]"
        renderValue={() => selectedRepo
          ? <span className="truncate"><span className="text-[var(--muted)]">{owner}/</span><span className="font-semibold">{name}</span></span>
          : <span className="text-[var(--faint)]">Choose a repository</span>}
        footer={repositories ? `${repositories.length} repositories with write access` : undefined}
      />
      {message && <p role="alert" className="popover absolute right-0 top-full z-50 mt-2 w-72 p-3 text-xs leading-5 text-[var(--warning)]">{message}</p>}
    </div>
  );
}