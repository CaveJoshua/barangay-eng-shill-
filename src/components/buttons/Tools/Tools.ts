/**
 * SmartBarangay Blotter Tools
 * Logic para sa MS Word-style text manipulation.
 */

/**
 * handleTextCommand
 * Executing document commands para sa contentEditable areas.
 * @param command - Ang format command (e.g., 'bold', 'justifyCenter')
 * @param value - Optional value para sa mga commands na nangangailangan nito
 */
export const handleTextCommand = (command: string, value: string | undefined = undefined): void => {
    try {
        // Sinisiguro nito na ang command ay tatakbo sa kasalukuyang active element
        // na may contentEditable attribute (ang iyong A4 Paper Preview).
        document.execCommand(command, false, value);
        
        // I-log para sa debugging kung kailangan
        console.log(`Formatting applied: ${command}`);
    } catch (error) {
        console.error("Failed to execute text command:", error);
    }
};

/**
 * getCleanText
 * Helper para alisin ang HTML tags bago ipasa sa interlogic.ts para sa PDF.
 */
export const getCleanText = (html: string): string => {
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = html;
    return tempDiv.innerText || tempDiv.textContent || "";
};