import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseEnumPipe,
  Patch,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ImageUploadInterceptor } from '../media/image-upload.interceptor';
import { UploadedImage } from '../media/media.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { UpdateRestaurantProfileDto } from './dto/restaurant-profile.dto';
import { BrandImage, TenantsService } from './tenants.service';

const BRAND_IMAGES = ['logo', 'cover'];
const brandImagePipe = new ParseEnumPipe(Object.fromEntries(BRAND_IMAGES.map((k) => [k, k])));

@ApiTags('tenants')
@ApiBearerAuth()
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get('current')
  @RequirePermissions('restaurant.read')
  @ApiOperation({ summary: 'Retorna o tenant do usuário autenticado' })
  findCurrent(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.tenantsService.findCurrent(user.tenantId);
  }

  @Get('current/profile')
  @RequirePermissions('restaurant.read')
  @ApiOperation({
    summary:
      'Perfil do restaurante: marca, contato, endereço e horários da unidade que recebe os pedidos online',
  })
  getProfile(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.tenantsService.getProfile(user.tenantId);
  }

  @Patch('current/profile')
  @RequirePermissions('restaurant.update')
  @ApiOperation({ summary: 'Altera o perfil do restaurante (só os campos enviados)' })
  updateProfile(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Body() dto: UpdateRestaurantProfileDto,
  ) {
    return this.tenantsService.updateProfile(user, dto);
  }

  @Put('current/:image')
  @RequirePermissions('restaurant.update')
  @UseInterceptors(ImageUploadInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Envia ou troca o logo (logo) ou a capa (cover): JPEG, PNG ou WebP, até 3 MB',
  })
  setImage(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('image', brandImagePipe) image: BrandImage,
    @UploadedFile() file: UploadedImage | undefined,
  ) {
    return this.tenantsService.setImage(user, image, file ?? { buffer: Buffer.alloc(0) });
  }

  @Delete('current/:image')
  @RequirePermissions('restaurant.update')
  @ApiOperation({ summary: 'Remove o logo (logo) ou a capa (cover)' })
  removeImage(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('image', brandImagePipe) image: BrandImage,
  ) {
    return this.tenantsService.setImage(user, image, null);
  }
}
