import { Controller, Delete, Get, Post, Query, Render, UseGuards } from '@nestjs/common';
import { CurrentShop } from '../common/current-customer.decorator';
import { InstallAuthGuard } from './install-auth.guard';
import { InstallService } from './install.service';

@Controller('install')
@UseGuards(InstallAuthGuard)
export class InstallController {
  constructor(private readonly installService: InstallService) {}

  @Get()
  @Render('dashboard')
  dashboard(@Query('shop') shop: string, @Query('key') key: string) {
    return { shop, key };
  }

  @Post()
  install(@CurrentShop() shop: string) {
    return this.installService.install(shop);
  }

  @Delete()
  uninstall(@CurrentShop() shop: string) {
    return this.installService.uninstall(shop);
  }
}
