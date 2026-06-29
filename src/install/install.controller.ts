import { Controller, Delete, Post } from '@nestjs/common';
import { InstallService } from './install.service';

@Controller('install')
export class InstallController {
  constructor(private readonly installService: InstallService) {}

  @Post()
  install() {
    return this.installService.install();
  }

  @Post('update')
  update() {
    return this.installService.update();
  }

  @Delete()
  uninstall() {
    return this.installService.uninstall();
  }
}
