import { Controller, Delete, Get, Post, Render } from '@nestjs/common';
import { InstallService } from './install.service';

@Controller('install')
export class InstallController {
  constructor(private readonly installService: InstallService) {}

  @Get()
  @Render('dashboard')
  dashboard() {
    return {};
  }

  @Post()
  install() {
    return this.installService.install();
  }

  @Delete()
  uninstall() {
    return this.installService.uninstall();
  }
}
