import { useCallback, useRef, useState } from "react";
import { parseWhistleRules } from "../modules/whistle";
import type { ProxyRule } from "../types";

interface WhistleEditorProps {
  initialValue: string;
  saveLabel?: string;
  onSave: (text: string, rules: ProxyRule[]) => void;
  onCancel?: () => void;
}

export function WhistleEditor({ initialValue, saveLabel = "保存", onSave, onCancel }: WhistleEditorProps) {
  const [text, setText] = useState(initialValue);
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const ta = e.currentTarget;
        const s = ta.selectionStart;
        const end = ta.selectionEnd;
        ta.value = ta.value.substring(0, s) + "  " + ta.value.substring(end);
        ta.selectionStart = ta.selectionEnd = s + 2;
        setText(ta.value);
      }
    },
    [],
  );

  const handleSave = useCallback(() => {
    try {
      const newRules = parseWhistleRules(text);
      if (newRules.length === 0 && text.trim().replace(/^#.*$/gm, "").trim()) {
        throw new Error("没有解析出有效规则，请检查格式");
      }
      onSave(text, newRules);
    } catch (err) {
      setError("错误: " + (err instanceof Error ? err.message : String(err)));
    }
  }, [text, onSave]);

  const height = Math.min(340, Math.max(160, text.split("\n").length * 17 + 16));

  return (
    <div className="rule-detail-panel">
      <textarea
        ref={textareaRef}
        className={`rule-editor ${error ? "error" : ""}`}
        value={text}
        spellCheck={false}
        placeholder={
          "# Whistle 格式，每行一条规则\n# 重定向\nhttps://source.com https://target.com\ndomain.com http://127.0.0.1:3000\n^domain.com/*** http://target/$1\nhost://target.host domain1 domain2\n127.0.0.1:6001 domain.com\n# 请求/响应头\ndomain.com reqHeaders://(X-Env: test)\n# 拦截控制\ndomain.com block://\ndomain.com mock://200 {\"data\":\"test\"}\ndomain.com delay://2000\ndomain.com disable://"
        }
        style={{ height: height + "px" }}
        onChange={(e) => {
          setText(e.target.value);
          setError("");
        }}
        onKeyDown={handleKeyDown}
      />
      <div className="rule-editor-actions">
        <span className={`rule-editor-hint ${error ? "error" : ""}`}>
          {error || "格式: domain target | ^domain/*** target/$1 | host://target domain | IP domain | reqHeaders:// | block:// | mock://STATUS | delay://MS"}
        </span>
        {onCancel && (
          <button className="btn" onClick={onCancel}>
            取消
          </button>
        )}
        <button className="btn btn-primary" onClick={handleSave}>
          {saveLabel}
        </button>
      </div>
    </div>
  );
}
