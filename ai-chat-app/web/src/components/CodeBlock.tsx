import React from "react";
import hljs from "highlight.js";

type Props = {
  language?: string;
  value: string;
};

export const CodeBlock: React.FC<Props> = ({ language, value }) => {
  const [copied, setCopied] = React.useState(false);
  const codeRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (codeRef.current) {
      hljs.highlightElement(codeRef.current);
    }
  }, [value, language]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  };

  return (
    <div className="relative group">
      <button
        type="button"
        onClick={handleCopy}
        className="absolute right-3 top-2 rounded bg-slate-800/80 px-2 py-1 text-xs text-slate-100 opacity-0 transition-opacity group-hover:opacity-100 dark:bg-slate-700"
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <pre className="overflow-x-auto rounded-lg bg-slate-900/90 p-3 text-sm text-slate-100">
        <code ref={codeRef} className={language ? `language-${language}` : ""}>
          {value}
        </code>
      </pre>
    </div>
  );
};

