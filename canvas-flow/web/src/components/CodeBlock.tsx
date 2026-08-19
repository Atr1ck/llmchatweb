import React from "react";
import "highlight.js/styles/github-dark.css";

type Props = {
  language?: string;
  value: string;
};

export const CodeBlock: React.FC<Props> = ({ language, value }) => {
  const [copied, setCopied] = React.useState(false);
  const [highlighted, setHighlighted] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    setHighlighted(null);
    void import("highlight.js/lib/common").then(({ default: hljs }) => {
      if (!active) return;
      if (language && hljs.getLanguage(language)) {
        setHighlighted(hljs.highlight(value, { language, ignoreIllegals: true }).value);
      } else {
        setHighlighted(hljs.highlightAuto(value).value);
      }
    });
    return () => {
      active = false;
    };
  }, [language, value]);

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
        <code
          className={`hljs ${language ? `language-${language}` : ""}`}
          {...(highlighted === null ? {} : { dangerouslySetInnerHTML: { __html: highlighted } })}
        >
          {highlighted === null ? value : null}
        </code>
      </pre>
    </div>
  );
};
