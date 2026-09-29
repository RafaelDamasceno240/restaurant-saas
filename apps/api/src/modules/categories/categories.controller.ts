import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@ApiTags('categories')
@ApiBearerAuth()
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @RequirePermissions('categories.read')
  @ApiOperation({ summary: 'Lista categorias do tenant autenticado' })
  findAll(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.categoriesService.findAllForTenant(user.tenantId);
  }

  @Get(':id')
  @RequirePermissions('categories.read')
  @ApiOperation({ summary: 'Busca uma categoria — 404 se pertencer a outro tenant' })
  findOne(@CurrentUser() user: AuthenticatedRequestUser, @Param('id') id: string) {
    return this.categoriesService.findOneForTenant(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('categories.create')
  @ApiOperation({ summary: 'Cria uma categoria' })
  create(@CurrentUser() user: AuthenticatedRequestUser, @Body() dto: CreateCategoryDto) {
    return this.categoriesService.create(user.tenantId, dto);
  }

  @Patch(':id')
  @RequirePermissions('categories.update')
  @ApiOperation({ summary: 'Edita (ou ativa/desativa) uma categoria' })
  update(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categoriesService.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('categories.delete')
  @ApiOperation({ summary: 'Exclui uma categoria (falha se houver produtos vinculados)' })
  remove(@CurrentUser() user: AuthenticatedRequestUser, @Param('id') id: string) {
    return this.categoriesService.remove(user.tenantId, id);
  }
}
