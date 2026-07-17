import { Module, type ModuleDoc } from '@/modules/module/module.model';

export const moduleRepository = {
  findAllPublished(): Promise<ModuleDoc[]> {
    return Module.find({ isPublished: true }).sort({ order: 1 }).exec() as Promise<ModuleDoc[]>;
  },

  findById(id: string): Promise<ModuleDoc | null> {
    return Module.findById(id).exec() as Promise<ModuleDoc | null>;
  },
};
