"use client";

import { useState } from "react";
import { 
  apiExportAllConversations, 
  apiPreviewConversationImport, 
  apiImportConversations,
  exportEncryptedConversations,
  previewEncryptedConversationImport,
  importEncryptedConversations
} from "../../../lib/api";

export default function ConversationsSettingsPage() {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importFileData, setImportFileData] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [showExportPassphrase, setShowExportPassphrase] = useState(false);
  const [exportPassphrase, setExportPassphrase] = useState("");
  const [exportPassphraseConfirm, setExportPassphraseConfirm] = useState("");

  const [isEncryptedImport, setIsEncryptedImport] = useState(false);
  const [importPassphrase, setImportPassphrase] = useState("");
  const [showImportPassphrase, setShowImportPassphrase] = useState(false);

  const resetMessages = () => {
    setError("");
    setSuccess("");
  };

  const handleExportAll = async () => {
    try {
      setExporting(true);
      resetMessages();
      const blob = await apiExportAllConversations();
      downloadBlob(blob, `unified-ai-conversations-${new Date().toISOString().split("T")[0]}.json`);
      setSuccess("Export downloaded successfully.");
    } catch (err: any) {
      setError(err.message || "Failed to export conversations.");
    } finally {
      setExporting(false);
    }
  };

  const handleEncryptedExport = async () => {
    if (exportPassphrase !== exportPassphraseConfirm) {
      setError("Passphrases do not match.");
      return;
    }
    if (!exportPassphrase) {
      setError("Passphrase cannot be empty.");
      return;
    }
    try {
      setExporting(true);
      resetMessages();
      const blob = await exportEncryptedConversations(exportPassphrase);
      downloadBlob(blob, `unified-ai-conversations-encrypted-${new Date().toISOString().split("T")[0]}.json`);
      setSuccess("Encrypted export downloaded successfully.");
      setShowExportPassphrase(false);
      setExportPassphrase("");
      setExportPassphraseConfirm("");
    } catch (err: any) {
      setError(err.message || "Failed to export encrypted conversations.");
    } finally {
      setExporting(false);
    }
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportFile(file);
    setPreview(null);
    resetMessages();
    setIsEncryptedImport(false);
    setShowImportPassphrase(false);
    setImportPassphrase("");

    try {
      const text = await file.text();
      const json = JSON.parse(text);
      setImportFileData(json);

      if (json.format === "unified-ai-workspace.encrypted-conversations") {
        setIsEncryptedImport(true);
        setShowImportPassphrase(true);
      } else {
        const prev = await apiPreviewConversationImport(json);
        setPreview(prev);
      }
    } catch (err: any) {
      setError(err.message || "Invalid JSON file.");
      setImportFile(null);
      setImportFileData(null);
    }
  };

  const handlePreviewEncryptedImport = async () => {
    if (!importPassphrase) {
      setError("Passphrase is required.");
      return;
    }
    try {
      resetMessages();
      const prev = await previewEncryptedConversationImport(importFileData, importPassphrase);
      setPreview(prev);
      setShowImportPassphrase(false);
    } catch (err: any) {
      setError(err.message || "Failed to decrypt. Wrong passphrase or corrupt file.");
      setPreview(null);
    }
  };

  const handleImport = async () => {
    if (!importFileData) return;
    try {
      setImporting(true);
      resetMessages();

      let result;
      if (isEncryptedImport) {
        result = await importEncryptedConversations(importFileData, importPassphrase, "create_new");
      } else {
        result = await apiImportConversations(importFileData, "create_new");
      }

      setSuccess(`Import successful! Added ${result.importedThreads} threads and ${result.importedMessages} messages.`);
      
      setImportFile(null);
      setImportFileData(null);
      setPreview(null);
      setIsEncryptedImport(false);
      setImportPassphrase("");
      
      const fileInput = document.getElementById('file-upload') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
    } catch (err: any) {
      setError(err.message || "Failed to import conversations.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-slate-100">Conversations Data</h1>
        <p className="text-slate-400 mt-2">
          Backup or restore your chat history securely. Exporting does not include API keys or session configurations.
        </p>
      </header>

      {error && (
        <div className="bg-red-500/10 text-red-400 p-4 rounded-lg border border-red-500/20">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-emerald-500/10 text-emerald-400 p-4 rounded-lg border border-emerald-500/20">
          {success}
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-200">Export Conversations</h2>
          <p className="text-sm text-slate-500 mt-1">Download all your chat history as a portable JSON file.</p>
        </div>
        
        <div className="flex flex-wrap gap-4">
          <button
            onClick={handleExportAll}
            disabled={exporting}
            className="px-6 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-medium transition-colors border border-slate-700 disabled:opacity-50"
          >
            {exporting ? "Exporting..." : "Export Standard JSON"}
          </button>

          <button
            onClick={() => setShowExportPassphrase(true)}
            disabled={exporting}
            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            Export Encrypted Backup
          </button>
        </div>

        {showExportPassphrase && (
          <div className="bg-slate-950 p-6 rounded-lg border border-slate-800 space-y-4">
            <h3 className="font-medium text-slate-200">Create Encrypted Backup</h3>
            <p className="text-sm text-amber-500/80">
              Warning: This passphrase cannot be recovered. If you lose it, you will not be able to restore this backup. Provider sessions and API keys are not included.
            </p>
            <div className="space-y-3">
              <input 
                type="password" 
                value={exportPassphrase}
                onChange={e => setExportPassphrase(e.target.value)}
                placeholder="Enter strong passphrase"
                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-slate-200 focus:outline-none focus:border-indigo-500"
              />
              <input 
                type="password" 
                value={exportPassphraseConfirm}
                onChange={e => setExportPassphraseConfirm(e.target.value)}
                placeholder="Confirm passphrase"
                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleEncryptedExport}
                disabled={exporting}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-medium transition-colors disabled:opacity-50"
              >
                Download Encrypted Backup
              </button>
              <button
                onClick={() => {
                  setShowExportPassphrase(false);
                  setExportPassphrase("");
                  setExportPassphraseConfirm("");
                  setError("");
                }}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-200">Import Conversations</h2>
          <p className="text-sm text-slate-500 mt-1">Restore chat history from a previous export JSON file.</p>
        </div>

        <div>
          <label className="block w-full border-2 border-dashed border-slate-700 hover:border-slate-500 bg-slate-950 rounded-lg p-6 text-center cursor-pointer transition-colors">
            <input 
              id="file-upload"
              type="file" 
              accept=".json" 
              className="hidden" 
              onChange={handleFileChange}
            />
            <span className="text-slate-400 font-medium">
              {importFile ? importFile.name : "Click to select a JSON file"}
            </span>
          </label>
        </div>

        {showImportPassphrase && (
          <div className="bg-slate-950 p-6 rounded-lg border border-slate-800 space-y-4">
            <h3 className="font-medium text-slate-200">Encrypted Backup Detected</h3>
            <p className="text-sm text-slate-400">Please enter the passphrase to decrypt this backup.</p>
            <input 
              type="password" 
              value={importPassphrase}
              onChange={e => setImportPassphrase(e.target.value)}
              placeholder="Enter passphrase"
              className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-slate-200 focus:outline-none focus:border-indigo-500"
            />
            <button
              onClick={handlePreviewEncryptedImport}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-medium transition-colors"
            >
              Decrypt & Preview
            </button>
          </div>
        )}

        {preview && (
          <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
            <h3 className="font-medium text-slate-300 mb-2">Import Preview</h3>
            <ul className="text-sm text-slate-400 space-y-1 mb-4">
              <li>• Valid: <span className="text-emerald-400">Yes</span></li>
              <li>• Threads to import: <span className="text-slate-200">{preview.threadCount}</span></li>
              <li>• Messages to import: <span className="text-slate-200">{preview.messageCount}</span></li>
            </ul>

            {preview.warnings && preview.warnings.length > 0 && (
              <div className="bg-amber-500/10 text-amber-400 p-3 rounded text-sm mb-4">
                <strong>Warnings:</strong>
                <ul className="list-disc pl-5 mt-1 space-y-1">
                  {preview.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}

            <button
              onClick={handleImport}
              disabled={importing || !preview.valid}
              className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              {importing ? "Importing..." : "Confirm Import"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
