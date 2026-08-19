import type { Request, Response } from 'express';

import type {
  AttachPdf,
  CreateModule,
  CreateVideo,
  IdParam,
  ModuleIdQuery,
  MultipartAbort,
  MultipartComplete,
  MultipartCreate,
  Process,
  Publish,
  Reorder,
  SourceUrl,
  TranscribeJobParam,
  TranscribeStart,
  UpdateModule,
  UpdateVideo,
  UploadUrl,
} from '@/modules/admin/admin.validators';
import { cmsService, toVideoDTO } from '@/modules/admin/cms.service';
import { mediaService } from '@/modules/media/media.service';
import { sendSuccess } from '@/utils/apiResponse';
import { asyncHandler } from '@/utils/asyncHandler';

export const cmsController = {
  // Catalog overview (stat cards + per-module summaries)
  overview: asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, await cmsService.overview());
  }),

  // Modules
  listModules: asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, await cmsService.listModules());
  }),
  createModule: asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await cmsService.createModule(req.body as CreateModule), undefined, 201);
  }),
  updateModule: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    sendSuccess(res, await cmsService.updateModule(id, req.body as UpdateModule));
  }),
  reorderModules: asyncHandler(async (req: Request, res: Response) => {
    await cmsService.reorderModules((req.body as Reorder).items);
    sendSuccess(res, { ok: true });
  }),
  deleteModule: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    sendSuccess(res, await cmsService.deleteModule(id));
  }),

  // Videos
  listVideos: asyncHandler(async (req: Request, res: Response) => {
    const { moduleId } = req.validated?.query as ModuleIdQuery;
    const videos = await cmsService.listVideosByModule(moduleId);
    sendSuccess(res, videos.map(toVideoDTO));
  }),
  createVideo: asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(
      res,
      toVideoDTO(await cmsService.createVideo(req.body as CreateVideo)),
      undefined,
      201,
    );
  }),
  updateVideo: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    sendSuccess(res, toVideoDTO(await cmsService.updateVideo(id, req.body as UpdateVideo)));
  }),
  setPublished: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    sendSuccess(
      res,
      toVideoDTO(await cmsService.setPublished(id, (req.body as Publish).published)),
    );
  }),
  reorderVideos: asyncHandler(async (req: Request, res: Response) => {
    await cmsService.reorderVideos((req.body as Reorder).items);
    sendSuccess(res, { ok: true });
  }),
  attachPdf: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    sendSuccess(res, toVideoDTO(await cmsService.attachPdf(id, req.body as AttachPdf)));
  }),

  // AWS media
  uploadUrl: asyncHandler(async (req: Request, res: Response) => {
    const { filename, contentType, sizeBytes, kind } = req.body as UploadUrl;
    sendSuccess(res, await cmsService.createUploadUrl(filename, contentType, sizeBytes, kind));
  }),
  multipartCreate: asyncHandler(async (req: Request, res: Response) => {
    const { filename, contentType, sizeBytes, kind } = req.body as MultipartCreate;
    sendSuccess(
      res,
      await cmsService.createMultipartUpload(filename, contentType, sizeBytes, kind),
    );
  }),
  multipartComplete: asyncHandler(async (req: Request, res: Response) => {
    const { key, uploadId, parts } = req.body as MultipartComplete;
    sendSuccess(res, await mediaService.completeMultipartUpload(key, uploadId, parts));
  }),
  multipartAbort: asyncHandler(async (req: Request, res: Response) => {
    const { key, uploadId } = req.body as MultipartAbort;
    await mediaService.abortMultipartUpload(key, uploadId);
    sendSuccess(res, { aborted: true });
  }),
  sourceUrl: asyncHandler(async (req: Request, res: Response) => {
    const { key } = req.body as SourceUrl;
    sendSuccess(res, { url: await mediaService.getSourceUrl(key) });
  }),
  processVideo: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    sendSuccess(res, toVideoDTO(await cmsService.processVideo(id, (req.body as Process).inputKey)));
  }),

  // Transcript (Add-video wizard): start a job, then poll it.
  startTranscript: asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await cmsService.startTranscript((req.body as TranscribeStart).inputKey));
  }),
  getTranscript: asyncHandler(async (req: Request, res: Response) => {
    const { jobName } = req.validated?.params as TranscribeJobParam;
    sendSuccess(res, await cmsService.getTranscript(jobName));
  }),
};
