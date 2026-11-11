import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ children, compact = false, className = "" }: { children: string; compact?: boolean; className?: string }) {
  return (
    <div className={`md ${compact ? "md-compact" : ""} ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: label }) => <a href={href} target="_blank" rel="noreferrer">{label}</a>,
          // eslint-disable-next-line @next/next/no-img-element
          img: ({ src, alt }) => typeof src === "string" ? <img src={src} alt={alt ?? ""} loading="lazy" referrerPolicy="no-referrer" /> : null,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}