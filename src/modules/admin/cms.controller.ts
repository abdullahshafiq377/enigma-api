import type { Request, Response } from 'express';

import type {
  AttachPdf,
  CreateModule,
  CreateVideo,
  IdParam,
  ModuleIdQuery,
  Process,
  Publish,
  Reorder,
  UpdateModule,
  UpdateVideo,
  UploadUrl,
} from '@/modules/admin/admin.validators';
import { cmsService, toVideoDTO } from '@/modules/admin/cms.service';
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
    const { filename, contentType } = req.body as UploadUrl;
    sendSuccess(res, await cmsService.createUploadUrl(filename, contentType));
  }),
  processVideo: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    sendSuccess(res, toVideoDTO(await cmsService.processVideo(id, (req.body as Process).inputKey)));
  }),
};
