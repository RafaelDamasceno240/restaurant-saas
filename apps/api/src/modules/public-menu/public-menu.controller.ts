import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { PublicMenuService } from './public-menu.service';
import { PublicMenuResponseDto } from './dto/public-menu-response.dto';

@ApiTags('public-menu')
@Public()
@Controller('public/menu')
export class PublicMenuController {
  constructor(private readonly publicMenuService: PublicMenuService) {}

  @Get(':slug')
  @ApiOperation({ summary: 'Cardápio público de um restaurante pelo slug (sem autenticação)' })
  getMenu(@Param('slug') slug: string): Promise<PublicMenuResponseDto> {
    return this.publicMenuService.getMenuBySlug(slug);
  }
}
