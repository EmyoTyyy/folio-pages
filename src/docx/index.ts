// Module .docx : import et export. Il est compilé à part et chargé à la
// demande (il contient la bibliothèque docx, lourde), pour ne pas ralentir
// l'ouverture de l'application.

export { exportDocx, type ExportLossCode, type ExportOptions, type ExportResult, type Loss } from './export'
export { importDocx, type ImportLossCode, type ImportResult } from './import'
export { DocxError, type DocxErrorCode } from './zip'
export { useMath, type MathKit } from './omml'
