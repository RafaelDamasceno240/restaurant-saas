import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { ImageUploadInterceptor } from '../media/image-upload.interceptor';
import { UploadedImage } from '../media/media.service';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ReorderProductsDto, SetProductOptionGroupsDto } from './dto/product-admin.dto';

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

  @Post('reorder')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('products.update')
  @ApiOperation({ summary: 'Define a ordem dos produtos de uma categoria (lista completa)' })
  reorder(@CurrentUser() user: AuthenticatedRequestUser, @Body() dto: ReorderProductsDto) {
    return this.productsService.reorder(user.tenantId, dto);
  }

  @Patch(':id')
  @RequirePermissions('products.update')
  @ApiOperation({ summary: 'Edita (ou ativa/desativa, esgota, destaca) um produto' })
  update(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productsService.update(user.tenantId, id, dto);
  }

  @Post(':id/duplicate')
  @RequirePermissions('products.create')
  @ApiOperation({ summary: 'Cria uma cópia do produto (com foto, promoção e adicionais)' })
  duplicate(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.productsService.duplicate(user.tenantId, id);
  }

  @Put(':id/photo')
  @RequirePermissions('products.update')
  @UseInterceptors(ImageUploadInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Envia ou troca a foto do produto (JPEG, PNG ou WebP, até 3 MB)' })
  setPhoto(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() file: UploadedImage | undefined,
  ) {
    return this.productsService.setPhoto(user.tenantId, id, file);
  }

  @Delete(':id/photo')
  @RequirePermissions('products.update')
  @ApiOperation({ summary: 'Remove a foto do produto' })
  removePhoto(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.productsService.removePhoto(user.tenantId, id);
  }

  @Put(':id/option-groups')
  @RequirePermissions('products.update')
  @ApiOperation({ summary: 'Define os grupos de adicionais do produto, na ordem de exibição' })
  setOptionGroups(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SetProductOptionGroupsDto,
  ) {
    return this.productsService.setOptionGroups(user.tenantId, id, dto.groupIds);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('products.delete')
  @ApiOperation({ summary: 'Exclui um produto' })
  remove(@CurrentUser() user: AuthenticatedRequestUser, @Param('id') id: string) {
    return this.productsService.remove(user.tenantId, id);
  }
}
