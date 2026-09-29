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
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@ApiTags('products')
@ApiBearerAuth()
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @RequirePermissions('products.read')
  @ApiOperation({ summary: 'Lista produtos do tenant autenticado' })
  findAll(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.productsService.findAllForTenant(user.tenantId);
  }

  @Get(':id')
  @RequirePermissions('products.read')
  @ApiOperation({ summary: 'Busca um produto — 404 se pertencer a outro tenant' })
  findOne(@CurrentUser() user: AuthenticatedRequestUser, @Param('id') id: string) {
    return this.productsService.findOneForTenant(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('products.create')
  @ApiOperation({ summary: 'Cria um produto (categoryId deve ser do mesmo tenant)' })
  create(@CurrentUser() user: AuthenticatedRequestUser, @Body() dto: CreateProductDto) {
    return this.productsService.create(user.tenantId, dto);
  }

  @Patch(':id')
  @RequirePermissions('products.update')
  @ApiOperation({ summary: 'Edita (ou ativa/desativa) um produto' })
  update(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productsService.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('products.delete')
  @ApiOperation({ summary: 'Exclui um produto' })
  remove(@CurrentUser() user: AuthenticatedRequestUser, @Param('id') id: string) {
    return this.productsService.remove(user.tenantId, id);
  }
}
