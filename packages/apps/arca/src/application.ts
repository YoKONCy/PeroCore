import path from 'node:path'
import {
  ArcaPortableProjectPackage,
  ContentAddressedBlobStore,
  SqliteDocumentEngine,
} from '@infos/document-engine'
import { ArcaModelRepository } from './modelRepository'
import { ArcaOfficeTasks } from './officeTasks'
import { ArcaOfficeService } from './officeService'

/** 自治办公内核：不持有宿主地址、传输、桌面归属或 infOS 后端服务。 */
export class ArcaApplication {
  readonly documents: SqliteDocumentEngine
  readonly blobs: ContentAddressedBlobStore
  readonly packages: ArcaPortableProjectPackage
  readonly models: ArcaModelRepository
  readonly officeTasks: ArcaOfficeTasks
  readonly office: ArcaOfficeService
  private stopping?: Promise<void>
  constructor(readonly dataPath: string) {
    this.documents = new SqliteDocumentEngine(path.join(dataPath, 'arca.sqlite'))
    try {
      this.blobs = new ContentAddressedBlobStore(path.join(dataPath, 'blobs'))
      this.packages = new ArcaPortableProjectPackage(this.documents, this.blobs)
      this.models = new ArcaModelRepository(path.join(dataPath, 'model-authority'))
      this.officeTasks = new ArcaOfficeTasks(
        path.join(dataPath, 'office-tasks.json'),
        this.documents,
        this.models,
      )
      this.office = new ArcaOfficeService(this.documents, this.blobs)
    } catch (error) {
      this.documents.close()
      throw error
    }
  }
  start(): void {
    if (this.stopping) throw new Error('Arca 内核已经停止')
    this.officeTasks.start()
  }
  stop(): Promise<void> {
    this.stopping ??= Promise.resolve().then(async () => {
      try {
        await this.officeTasks.stop()
      } finally {
        this.documents.close()
      }
    })
    return this.stopping
  }
}
